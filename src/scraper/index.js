'use strict';

const { getDb } = require('../db');
const { getBrowser } = require('./browser');
const { scrapeListingPage } = require('./listingPage');
const { scrapeDetailPage, verifyItemAvailable, readAdCreationDate } = require('./detailPage');
const { diffSnapshots } = require('./differ');
const { enqueue } = require('../lib/extract-queue');
const { normalizeItemImages } = require('../lib/item-images');

const SNAPSHOT_FIELDS = ['title', 'price', 'price_text', 'location', 'description', 'image_urls', 'seller_name'];

function snapshotsIdentical(prev, curr) {
  if (!prev) return false;
  return SNAPSHOT_FIELDS.every(f => {
    const a = prev[f] != null ? String(prev[f]) : null;
    const b = curr[f] != null ? String(curr[f]) : null;
    return a === b;
  });
}

async function scrapeSource(sourceId) {
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  const scrapeStart = new Date().toISOString();
  const stats = { newItems: 0, changedItems: 0, removedItems: 0 };

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const filters = {
      keyword: source.keyword || null,
      min_price: source.min_price || null,
      max_price: source.max_price || null,
    };

    const cards = await scrapeListingPage(page, source.url, filters);
    const scrapedIds = new Set(cards.map(c => c.external_id));

    const provider = 'kleinanzeigen.de';

    const insertItem = db.prepare(`
      INSERT INTO items (source_id, provider, external_id, url, title, price, price_text, location, thumbnail_url)
      VALUES (@source_id, @provider, @external_id, @url, @title, @price, @price_text, @location, @thumbnail_url)
      ON CONFLICT(provider, external_id) DO UPDATE SET
        last_seen_at = datetime('now'),
        title = excluded.title,
        price = excluded.price,
        price_text = excluded.price_text,
        location = excluded.location,
        thumbnail_url = excluded.thumbnail_url,
        removed_at = NULL
    `);

    const updateItem = db.prepare(`
      UPDATE items SET description = @description, image_urls = COALESCE(@image_urls, image_urls),
        seller_name = @seller_name, seller_url = @seller_url, last_seen_at = datetime('now'),
        ad_created_date = COALESCE(ad_created_date, @ad_created_date)
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
    const getItem = db.prepare('SELECT * FROM items WHERE provider = ? AND external_id = ?');
    const setCreationDate = db.prepare('UPDATE items SET ad_created_date = ? WHERE id = ? AND ad_created_date IS NULL');

    async function saveCreationDate(item) {
      if (item.ad_created_date) return;
      const creationDate = await readAdCreationDate(page, item.external_id).catch(() => null);
      if (creationDate) setCreationDate.run(creationDate, item.id);
    }

    // Build detail queue outside any transaction (network I/O must be separate)
    const detailQueue = [];
    for (const card of cards) {
      insertItem.run({ source_id: sourceId, provider, ...card });
      const item = getItem.get(provider, card.external_id);
      const prevSnapshot = getLastSnapshot.get(item.id);
      const hasGallery = normalizeItemImages({ image_urls: item.image_urls }).length > 0;
      const needsDetail = !prevSnapshot || !item.description || !hasGallery;
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
            ad_created_date: fullItem.ad_created_date,
            description: fullItem.description || item.description || '',
            image_urls: normalizeItemImages({ image_urls: fullItem.image_urls }).length ? fullItem.image_urls : null,
            seller_name: fullItem.seller_name || item.seller_name || null,
            seller_url: fullItem.seller_url || item.seller_url || null,
          });
        } catch (e) {
          console.warn(`Detail scrape failed for item ${item.id}: ${e.message}`);
        }
      } else if (!item.ad_created_date && await verifyItemAvailable(page, item.url)) {
        await saveCreationDate(item);
      }

      db.transaction(() => {
        const snapshotData = {
          item_id: item.id, source_id: sourceId,
          title: fullItem.title, price: fullItem.price, price_text: fullItem.price_text,
          location: fullItem.location,
          description: fullItem.description || item.description,
          image_urls: fullItem.image_urls || item.image_urls,
          seller_name: fullItem.seller_name || item.seller_name,
          raw_data: JSON.stringify(fullItem),
        };

        if (snapshotsIdentical(prevSnapshot, snapshotData)) return;

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

      // Auto-enqueue for AI extraction if description available and no specs yet
      const freshItem = getItem.get(provider, card.external_id);
      if (freshItem && freshItem.description && !freshItem.specs) {
        enqueue(freshItem.id);
      }
    }

    // Mark removed items — with false-positive safeguards:
    // • Skip entirely if scrape returned 0 cards: likely bot block, CAPTCHA, or selector failure
    //   rather than all items genuinely gone.
    // • Grace period of 2× the source interval: a single missed scrape (pagination shuffle,
    //   transient network hiccup) won't flag an item as removed. Items must be absent for
    //   two consecutive full cycles before being marked removed.
    // • If the scraper threw earlier (full network loss), this block is never reached at all.
    if (cards.length === 0) {
      console.warn(`[scraper] source ${sourceId}: 0 cards returned — skipping mark-removed to avoid false positives`);
    } else {
      const graceMs = source.interval * 2 * 60 * 1000;
      const removeCutoff = new Date(Date.now() - graceMs).toISOString();
      const allItems = db.prepare(
        'SELECT id, external_id, url, last_seen_at, ad_created_date FROM items WHERE source_id = ? AND removed_at IS NULL'
      ).all(sourceId);
      const markRemoved = db.prepare("UPDATE items SET removed_at = datetime('now') WHERE id = ?");
      for (const it of allItems) {
        if (!scrapedIds.has(it.external_id) && it.last_seen_at < removeCutoff) {
          const stillLive = await verifyItemAvailable(page, it.url);
          if (stillLive) {
            await saveCreationDate(it);
            console.log(`[scraper] item ${it.id} not in listing page but still live — skipping removal`);
            continue;
          }
          markRemoved.run(it.id);
          stats.removedItems++;
        }
      }
    }

    db.prepare(`
      UPDATE sources SET
        item_count = (SELECT COUNT(*) FROM items WHERE source_id = ? AND removed_at IS NULL),
        last_scraped_at = ?, last_error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(sourceId, scrapeStart, sourceId);

  } catch (err) {
    db.prepare("UPDATE sources SET last_error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(err.message, sourceId);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return stats;
}

module.exports = { scrapeSource };
