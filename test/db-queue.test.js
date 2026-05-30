'use strict';

/**
 * DB/queue tests using a temp SQLite file.
 *
 * ISOLATION STRATEGY:
 * src/db/index.js caches dbPath at module load time (line 6) and keeps a
 * singleton _db.  To avoid contaminating the real DB and to allow multiple
 * test suites to run in the same process we:
 *  1. Set process.env.DB_PATH before the first require of the db module.
 *  2. Delete all db-related keys from require.cache after each test group so
 *     the next require gets a fresh singleton pointed at the right path.
 *  3. Keep a reference to the Database instance via getDb() to call closeDb()
 *     before deleting the temp file.
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempPath() {
  return path.join(os.tmpdir(), `ka-agent-test-${process.pid}-${Date.now()}.db`);
}

/**
 * Returns absolute paths for all require.cache keys that belong to our src/db
 * and src/lib/extract-queue modules so we can evict them and force a fresh load.
 */
function dbModuleKeys() {
  const base = path.resolve(__dirname, '../src');
  return Object.keys(require.cache).filter(k =>
    k.startsWith(base + '/db') || k.includes('extract-queue')
  );
}

function purgeDbModules() {
  for (const k of dbModuleKeys()) delete require.cache[k];
}

/**
 * Load a fresh copy of the db module pointed at the given path.
 * Caller must call purgeDbModules() + closeDb() to clean up.
 */
function loadDb(dbPath) {
  process.env.DB_PATH = dbPath;
  purgeDbModules();
  return require('../src/db/index');
}

/**
 * Apply schema.sql to an open Database instance.
 */
function applySchema(db) {
  const sql = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.sql'), 'utf8');
  db.exec(sql);
}

/**
 * Insert a minimal source row and return its id (required FK for items).
 */
function insertSource(db) {
  const info = db.prepare(
    "INSERT INTO sources (name, url) VALUES ('test source', 'https://example.com')"
  ).run();
  return info.lastInsertRowid;
}

/**
 * Insert a minimal item row and return its id.
 */
function insertItem(db, sourceId, opts = {}) {
  const info = db.prepare(`
    INSERT INTO items (source_id, external_id, url, title, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    sourceId,
    opts.external_id || `ext-${Math.random()}`,
    opts.url || 'https://example.com/item/1',
    opts.title || 'Test Item',
    opts.description || 'Some description'
  );
  return info.lastInsertRowid;
}

// ── Schema integrity ──────────────────────────────────────────────────────────

describe('DB schema — column and table presence', () => {
  let dbPath;
  let db;

  before(() => {
    dbPath = makeTempPath();
    const { getDb } = loadDb(dbPath);
    db = getDb();
    applySchema(db);
  });

  after(() => {
    const { closeDb } = require('../src/db/index');
    closeDb();
    purgeDbModules();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  test('extract_queue table exists', () => {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='extract_queue'"
    ).get();
    assert.ok(row, 'extract_queue table should exist');
  });

  test('extract_queue has worker_id column', () => {
    const cols = db.prepare('PRAGMA table_info(extract_queue)').all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('worker_id'), 'worker_id column must exist');
  });

  test('extract_queue has claimed_at column', () => {
    const cols = db.prepare('PRAGMA table_info(extract_queue)').all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('claimed_at'), 'claimed_at column must exist');
  });

  test('sources table exists', () => {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sources'"
    ).get();
    assert.ok(row);
  });

  test('items table exists', () => {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='items'"
    ).get();
    assert.ok(row);
  });

  test('snapshots table exists', () => {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='snapshots'"
    ).get();
    assert.ok(row);
  });

  test('changes table exists', () => {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='changes'"
    ).get();
    assert.ok(row);
  });

  test('items table has is_hidden column', () => {
    const cols = db.prepare('PRAGMA table_info(items)').all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('is_hidden'));
  });

  test('items table has specs column', () => {
    const cols = db.prepare('PRAGMA table_info(items)').all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('specs'));
  });

  test('items table has score column', () => {
    const cols = db.prepare('PRAGMA table_info(items)').all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('score'));
  });

  test('extract_queue enforces UNIQUE on item_id: duplicate INSERT throws', () => {
    // Insert a fresh item and enqueue it once.
    const sid = insertSource(db);
    const iid = insertItem(db, sid, { external_id: 'ext-unique-test' });
    db.prepare(
      "INSERT INTO extract_queue (item_id, status) VALUES (?, 'pending')"
    ).run(iid);

    // A second direct INSERT for the same item_id must violate the UNIQUE constraint.
    assert.throws(
      () => db.prepare("INSERT INTO extract_queue (item_id, status) VALUES (?, 'pending')").run(iid),
      /UNIQUE constraint failed/i,
      'duplicate item_id must throw a UNIQUE constraint error'
    );

    // Exactly one row exists for this item.
    const rows = db.prepare('SELECT * FROM extract_queue WHERE item_id = ?').all(iid);
    assert.equal(rows.length, 1, 'only one queue row may exist per item_id');
  });
});

// ── enqueue idempotency ───────────────────────────────────────────────────────

describe('enqueue — idempotency', () => {
  let dbPath;
  let enqueue;
  let db;
  let sourceId;

  before(() => {
    dbPath = makeTempPath();
    const dbMod = loadDb(dbPath);
    db = dbMod.getDb();
    applySchema(db);
    sourceId = insertSource(db);

    // Load extract-queue after DB is ready so it picks up the same DB_PATH
    const qMod = require('../src/lib/extract-queue');
    enqueue = qMod.enqueue;
  });

  after(() => {
    const { closeDb } = require('../src/db/index');
    closeDb();
    purgeDbModules();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  test('first enqueue inserts a pending row; repeated enqueues are no-ops', () => {
    // Each assertion uses its own fresh item so there is no cross-test state.
    const itemId = insertItem(db, sourceId, { external_id: `ext-idempotent-${Date.now()}` });

    // First call: row must appear as pending
    enqueue(itemId);
    const row = db.prepare('SELECT * FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.ok(row, 'queue row should exist after first enqueue');
    assert.equal(row.status, 'pending');

    // Second call: must not throw (INSERT OR IGNORE)
    assert.doesNotThrow(() => enqueue(itemId), 'second enqueue must not throw');

    // Third call: still only one row
    enqueue(itemId);
    const rows = db.prepare('SELECT * FROM extract_queue WHERE item_id = ?').all(itemId);
    assert.equal(rows.length, 1, 'exactly one queue row should exist after multiple enqueues');

    // Status must remain pending
    const after = db.prepare('SELECT status FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(after.status, 'pending', 'repeated enqueue must not change status from pending');
  });
});

// ── reEnqueue — does not clobber processing rows ──────────────────────────────

describe('reEnqueue — race-condition safety and failed row reset', () => {
  let dbPath;
  let reEnqueue;
  let enqueue;
  let db;
  let sourceId;

  before(() => {
    dbPath = makeTempPath();
    const dbMod = loadDb(dbPath);
    db = dbMod.getDb();
    applySchema(db);
    sourceId = insertSource(db);

    const qMod = require('../src/lib/extract-queue');
    enqueue = qMod.enqueue;
    reEnqueue = qMod.reEnqueue;
  });

  after(() => {
    const { closeDb } = require('../src/db/index');
    closeDb();
    purgeDbModules();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  test('reEnqueue on a processing row does NOT change its status', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-processing-1' });
    enqueue(itemId);
    // Simulate worker claiming the item by setting status = 'processing'
    db.prepare("UPDATE extract_queue SET status='processing', worker_id=1 WHERE item_id=?").run(itemId);

    reEnqueue(itemId);

    const row = db.prepare('SELECT status FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(row.status, 'processing', 'reEnqueue must not clobber a processing row');
  });

  test('reEnqueue on a processing row does NOT reset worker_id to null', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-processing-2' });
    enqueue(itemId);
    db.prepare("UPDATE extract_queue SET status='processing', worker_id=99 WHERE item_id=?").run(itemId);

    reEnqueue(itemId);

    const row = db.prepare('SELECT worker_id FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(row.worker_id, 99, 'worker_id must be preserved on a processing row');
  });

  test('reEnqueue resets a failed row back to pending', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-failed-1' });
    enqueue(itemId);
    db.prepare(
      "UPDATE extract_queue SET status='failed', last_error='something broke' WHERE item_id=?"
    ).run(itemId);

    reEnqueue(itemId);

    const row = db.prepare('SELECT * FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(row.status, 'pending', 'failed row should be reset to pending');
  });

  test('reEnqueue clears last_error on a failed row', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-failed-2' });
    enqueue(itemId);
    db.prepare(
      "UPDATE extract_queue SET status='failed', last_error='boom' WHERE item_id=?"
    ).run(itemId);

    reEnqueue(itemId);

    const row = db.prepare('SELECT last_error FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(row.last_error, null, 'last_error should be cleared on reEnqueue');
  });

  test('reEnqueue resets attempts to 0 on a failed row', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-failed-3' });
    enqueue(itemId);
    db.prepare(
      "UPDATE extract_queue SET status='failed', attempts=3 WHERE item_id=?"
    ).run(itemId);

    reEnqueue(itemId);

    const row = db.prepare('SELECT attempts FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(row.attempts, 0);
  });

  test('reEnqueue on a pending row resets it (idempotent reset)', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-pending-reset' });
    enqueue(itemId);
    // Set next_attempt_at to the past, attempts to non-zero
    db.prepare(
      "UPDATE extract_queue SET attempts=2, next_attempt_at=datetime('now', '-1 hour') WHERE item_id=?"
    ).run(itemId);

    reEnqueue(itemId);

    const row = db.prepare('SELECT * FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
  });

  test('reEnqueue inserts a fresh pending row if item was not previously enqueued', () => {
    const itemId = insertItem(db, sourceId, { external_id: 'ext-fresh-reenqueue' });
    // No prior enqueue call
    reEnqueue(itemId);

    const row = db.prepare('SELECT * FROM extract_queue WHERE item_id = ?').get(itemId);
    assert.ok(row, 'row should be created');
    assert.equal(row.status, 'pending');
  });
});
