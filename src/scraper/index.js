'use strict';

const { getDb } = require('../db');
const { getBrowser } = require('./browser');
const { scrapeListingPage } = require('./listingPage');
const { scrapeDetailPage } = require('./detailPage');
const { diffSnapshots } = require('./differ');

async function scrapeSource(sourceId) {
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  const scrapeStart = new Date().toISOString();
  const stats = { newItems: 0, changedItems: 0, removedItems: 0 };

  try {
    const browser = await getBrowser();
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const filters = {
      keyword: source.keyword || null,
      min_price: source.min_price || null,
      max_price: source.max_price || null,
    };

    const cards = await scrapeListingPage(page, source.url, filters);
    const scrapedIds = new Set(cards.map(c => c.external_id));

    const insertItem = db.prepare(`
      INSERT INTO items (source_id, external_id, url, title, price, price_text, location, thumbnail_url)
      VALUES (@source_id, @external_id, @url, @title, @price, @price_text, @location, @thumbnail_url)
      ON CONFLICT(source_id, external_id) DO UPDATE SET
        last_seen_at = datetime('now'),
        title = excluded.title,
        price = excluded.price,
        price_text = excluded.price_text,
        location = excluded.location,
        thumbnail_url = excluded.thumbnail_url,
        removed_at = NULL
    `);

    const updateItem = db.prepare(`
      UPDATE items SET description = @description, image_urls = @image_urls,
        seller_name = @seller_name, seller_url = @seller_url, last_seen_at = datetime('now')
      WHERE id = @id
    `);

    const insertSnapshot = db.prepare(`
      INSERT INTO snapshots (item_id, source_id, title, price, price_text, location, description, image_urls, seller_name, raw_data)
      VALUES (@item_id, @source_id, @title, @price, @price_text, @location, @description, @image_urls, @seller_name, @raw_data)
    `);

    const insertChange = db.prepare(`
      INSERT INTO changes (item_id, source_id, snapshot_id, prev_snapshot_id, change_type, field_name, old_value, new_value)
      VALUES (@item_id, @source_id, @snapshot_id, @prev_snapshot_id, @change_type, @field_name, @old_value, @new_value)
    `);

    const getLastSnapshot = db.prepare('SELECT * FROM snapshots WHERE item_id = ? ORDER BY scraped_at DESC LIMIT 1');
    const getItem = db.prepare('SELECT * FROM items WHERE source_id = ? AND external_id = ?');

    const doScrape = db.transaction(() => {
      for (const card of cards) {
        insertItem.run({ source_id: sourceId, ...card });
        const item = getItem.get(sourceId, card.external_id);
        const prevSnapshot = getLastSnapshot.get(item.id);

        // Only fetch detail page for new items or items not scraped in last hour
        const needsDetail = !prevSnapshot || !item.description;

        if (needsDetail) {
          return { item, prevSnapshot, card, needsDetail: true };
        }

        // Still create snapshot and diff for listing-level changes
        const snapshotData = {
          item_id: item.id, source_id: sourceId,
          title: card.title, price: card.price, price_text: card.price_text,
          location: card.location, description: item.description,
          image_urls: item.image_urls, seller_name: item.seller_name,
          raw_data: JSON.stringify(card),
        };
        const snapshotResult = insertSnapshot.run(snapshotData);
        const changes = diffSnapshots(prevSnapshot, snapshotData);
        for (const ch of changes) {
          insertChange.run({
            item_id: item.id, source_id: sourceId,
            snapshot_id: snapshotResult.lastInsertRowid,
            prev_snapshot_id: prevSnapshot ? prevSnapshot.id : null,
            ...ch,
          });
          if (ch.change_type !== 'new') stats.changedItems++;
          if (ch.change_type === 'new') stats.newItems++;
        }
      }
      return null;
    });

    // Process cards that need detail page fetch outside transaction
    const detailQueue = [];
    for (const card of cards) {
      insertItem.run({ source_id: sourceId, ...card });
      const item = getItem.get(sourceId, card.external_id);
      const prevSnapshot = getLastSnapshot.get(item.id);
      const needsDetail = !prevSnapshot || !item.description;
      detailQueue.push({ item, prevSnapshot, card, needsDetail });
    }

    for (const entry of detailQueue) {
      const { item, prevSnapshot, card, needsDetail } = entry;
      let fullItem = { ...item, ...card };

      if (needsDetail) {
        try {
          fullItem = await scrapeDetailPage(page, fullItem);
          updateItem.run({
            id: item.id,
            description: fullItem.description || '',
            image_urls: fullItem.image_urls || null,
            seller_name: fullItem.seller_name || null,
            seller_url: fullItem.seller_url || null,
          });
        } catch (e) {
          console.warn(`Detail scrape failed for item ${item.id}: ${e.message}`);
        }
      }

      db.transaction(() => {
        const snapshotData = {
          item_id: item.id, source_id: sourceId,
          title: fullItem.title, price: fullItem.price, price_text: fullItem.price_text,
          location: fullItem.location, description: fullItem.description || item.description,
          image_urls: fullItem.image_urls || item.image_urls,
          seller_name: fullItem.seller_name || item.seller_name,
          raw_data: JSON.stringify(fullItem),
        };
        const snapshotResult = insertSnapshot.run(snapshotData);
        const changes = diffSnapshots(prevSnapshot, snapshotData);
        for (const ch of changes) {
          insertChange.run({
            item_id: item.id, source_id: sourceId,
            snapshot_id: snapshotResult.lastInsertRowid,
            prev_snapshot_id: prevSnapshot ? prevSnapshot.id : null,
            ...ch,
          });
          if (ch.change_type === 'new') stats.newItems++;
          else stats.changedItems++;
        }
      })();
    }

    // Mark removed items
    const allItems = db.prepare('SELECT id, external_id FROM items WHERE source_id = ? AND removed_at IS NULL').all(sourceId);
    const markRemoved = db.prepare('UPDATE items SET removed_at = datetime(\'now\') WHERE id = ?');
    for (const it of allItems) {
      if (!scrapedIds.has(it.external_id)) {
        markRemoved.run(it.id);
        stats.removedItems++;
      }
    }

    await page.close();

    db.prepare(`UPDATE sources SET item_count = (SELECT COUNT(*) FROM items WHERE source_id = ? AND removed_at IS NULL),
      last_scraped_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(sourceId, scrapeStart, sourceId);

  } catch (err) {
    db.prepare('UPDATE sources SET last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(err.message, sourceId);
    throw err;
  }

  return stats;
}

module.exports = { scrapeSource };
