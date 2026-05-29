'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./index');

// Each entry runs exactly once, identified by version number.
// IMPORTANT: always append new migrations at the end AND keep version numbers
// strictly ascending. The array is sorted by version at runtime as a safety net,
// but out-of-order entries here are a maintenance trap.
const migrations = [
  {
    version: 1,
    description: 'add provider column to items, UNIQUE(provider, external_id)',
    run(db) {
      db.exec(`
        CREATE TABLE items_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          provider        TEXT    NOT NULL DEFAULT 'kleinanzeigen.de',
          external_id     TEXT    NOT NULL,
          url             TEXT    NOT NULL,
          title           TEXT    NOT NULL,
          price           REAL,
          price_text      TEXT,
          location        TEXT,
          seller_name     TEXT,
          seller_url      TEXT,
          thumbnail_url   TEXT,
          description     TEXT,
          image_urls      TEXT,
          first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
          removed_at      TEXT,
          UNIQUE(provider, external_id)
        );
        INSERT INTO items_new
          SELECT id, source_id, 'kleinanzeigen.de', external_id, url, title, price, price_text,
                 location, seller_name, seller_url, thumbnail_url, description, image_urls,
                 first_seen_at, last_seen_at, removed_at
          FROM items;
        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;
        CREATE INDEX IF NOT EXISTS idx_items_source_id     ON items(source_id);
        CREATE INDEX IF NOT EXISTS idx_items_first_seen_at ON items(first_seen_at);
        CREATE INDEX IF NOT EXISTS idx_items_removed_at    ON items(removed_at);
      `);
    },
  },
  {
    version: 2,
    description: 'add is_hidden flag to items',
    run(db) {
      db.exec('ALTER TABLE items ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 3,
    description: 'add specs JSON column to items for AI extraction',
    run(db) {
      db.exec('ALTER TABLE items ADD COLUMN specs TEXT');
    },
  },
  {
    version: 4,
    description: 'add extract_queue table and remove duplicate snapshots',
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS extract_queue (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          status          TEXT NOT NULL DEFAULT 'pending',
          attempts        INTEGER NOT NULL DEFAULT 0,
          last_error      TEXT,
          next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_extract_queue_status ON extract_queue(status);
      `);

      // Remove snapshots that are identical to their immediate predecessor
      db.exec(`
        DELETE FROM snapshots WHERE id NOT IN (
          SELECT MIN(id) FROM snapshots GROUP BY item_id
          UNION ALL
          SELECT s.id FROM snapshots s
          JOIN snapshots p ON p.item_id = s.item_id
            AND p.scraped_at = (
              SELECT MAX(scraped_at) FROM snapshots
              WHERE item_id = s.item_id AND scraped_at < s.scraped_at
            )
          WHERE COALESCE(s.title,'') != COALESCE(p.title,'')
             OR COALESCE(CAST(s.price AS TEXT),'') != COALESCE(CAST(p.price AS TEXT),'')
             OR COALESCE(s.price_text,'') != COALESCE(p.price_text,'')
             OR COALESCE(s.location,'') != COALESCE(p.location,'')
             OR COALESCE(s.description,'') != COALESCE(p.description,'')
             OR COALESCE(s.image_urls,'') != COALESCE(p.image_urls,'')
             OR COALESCE(s.seller_name,'') != COALESCE(p.seller_name,'')
        )
      `);
    },
  },
  {
    version: 5,
    description: 'add score column to items and backfill from existing specs',
    run(db) {
      db.exec('ALTER TABLE items ADD COLUMN score INTEGER');
      // Backfill scores for items that already have specs
      const { scoreItem } = require('../lib/scorer');
      const items = db.prepare('SELECT id, specs FROM items WHERE specs IS NOT NULL').all();
      const update = db.prepare('UPDATE items SET score = ? WHERE id = ?');
      let filled = 0;
      for (const it of items) {
        try {
          const specs = JSON.parse(it.specs);
          const score = scoreItem(specs);
          if (score !== null) { update.run(score, it.id); filled++; }
        } catch {}
      }
      console.log(`[migrate] scored ${filled}/${items.length} existing items`);
    },
  },
];

function migrate() {
  const db = getDb();

  // schema_migrations must exist before anything else
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const isFresh = !db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sources'"
  ).get();

  if (isFresh) {
    // New install: apply the full current schema (already contains all columns)
    // and mark every migration as done — no delta work needed.
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
    const insert = db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)');
    for (const m of migrations) insert.run(m.version);
    console.log('[migrate] fresh install complete');
    return;
  }

  // Existing DB: run only versions not yet recorded
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').pluck().all()
  );

  // Sort by version as a safety net — array order in source should already be correct
  const pending = migrations
    .filter(m => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const m of pending) {
    console.log(`[migrate] applying v${m.version}: ${m.description}`);
    db.transaction(() => m.run(db))();
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    console.log(`[migrate] v${m.version} done`);
  }

  console.log('[migrate] up to date');
}

module.exports = { migrate };
