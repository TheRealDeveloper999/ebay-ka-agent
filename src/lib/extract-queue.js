'use strict';

const { getDb } = require('../db');
const { extractSpecs, getEarliestKeyReset, getKeyCount } = require('./extractor');
const { scoreItem } = require('./scorer');

const MAX_ITEM_ATTEMPTS = 3;
const MAX_CONSECUTIVE_API_FAILURES = 10;
const MAX_CONSECUTIVE_ITEM_FAILURES = 3;
const PAUSE_MS = 30 * 60 * 1000;
const POLL_MS = 5000; // only used when queue is empty

// One worker per API key, overridable via env
const CONCURRENCY = parseInt(process.env.EXTRACT_CONCURRENCY || '0', 10) || Math.max(1, getKeyCount());

let running = false;
let consecutiveApiFailures = 0;
let consecutiveItemFailures = 0;
let pauseUntil = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- Public queue operations ---

function enqueue(itemId) {
  getDb().prepare('INSERT OR IGNORE INTO extract_queue (item_id) VALUES (?)').run(itemId);
}

function reEnqueue(itemId) {
  getDb().prepare(`
    INSERT INTO extract_queue (item_id) VALUES (?)
    ON CONFLICT(item_id) DO UPDATE SET
      status = 'pending', attempts = 0, last_error = NULL,
      next_attempt_at = datetime('now')
    WHERE extract_queue.status != 'processing'
  `).run(itemId);
}

function getQueueEntry(itemId) {
  return getDb().prepare('SELECT * FROM extract_queue WHERE item_id = ?').get(itemId);
}

// Atomically claim the next pending item and mark it as processing.
// SQLite transaction ensures two concurrent workers never claim the same row.
function claimNextItem() {
  return getDb().transaction(() => {
    const db = getDb();
    const entry = db.prepare(`
      SELECT eq.id, eq.attempts, i.id as item_id, i.description
      FROM extract_queue eq
      JOIN items i ON i.id = eq.item_id
      WHERE eq.status = 'pending'
        AND eq.next_attempt_at <= datetime('now')
        AND i.description IS NOT NULL AND i.description != ''
      ORDER BY eq.created_at ASC
      LIMIT 1
    `).get();
    if (!entry) return null;
    db.prepare("UPDATE extract_queue SET status='processing', attempts=attempts+1 WHERE id=?").run(entry.id);
    return entry;
  })();
}

// --- Worker loop ---

async function runWorker(workerId) {
  try {
    await runWorkerLoop(workerId);
  } catch (err) {
    console.error(`[extract-queue] w${workerId} crashed unexpectedly:`, err);
    // Reset any item this worker may have left stuck in 'processing'
    try {
      // We don't know which item it was, so reset all stuck items
      getDb().prepare("UPDATE extract_queue SET status='pending' WHERE status='processing'").run();
    } catch (_) {}
    if (running) {
      console.log(`[extract-queue] w${workerId} restarting in 5s`);
      setTimeout(() => runWorker(workerId), 5000);
    }
  }
}

async function runWorkerLoop(workerId) {
  const db = getDb();

  while (running) {
    // Respect global pause (key exhaustion, circuit breaker)
    if (pauseUntil && Date.now() < pauseUntil) {
      await sleep(Math.min(POLL_MS, pauseUntil - Date.now()));
      continue;
    }
    pauseUntil = null;

    const entry = claimNextItem();
    if (!entry) {
      await sleep(POLL_MS); // nothing to do — poll
      continue;
    }

    try {
      const specs = await extractSpecs(entry.description);
      const score = scoreItem(specs);
      db.transaction(() => {
        db.prepare('UPDATE items SET specs=?, score=? WHERE id=?').run(JSON.stringify(specs), score, entry.item_id);
        db.prepare("UPDATE extract_queue SET status='done' WHERE id=?").run(entry.id);
      })();
      consecutiveApiFailures = 0;
      consecutiveItemFailures = 0;
      console.log(`[extract-queue] w${workerId}: done item ${entry.item_id}`);

    } catch (err) {
      const attempt = entry.attempts + 1;

      // All API keys at daily limit — pause until earliest key resets
      const keyReset = getEarliestKeyReset();
      if (keyReset) {
        pauseUntil = keyReset;
        consecutiveApiFailures = 0; // key exhaustion is not a transient failure
        const mins = Math.ceil((keyReset - Date.now()) / 60000);
        console.warn(`[extract-queue] all keys exhausted — pausing ${mins}min`);
        db.prepare("UPDATE extract_queue SET status='pending', last_error=? WHERE id=?").run(err.message, entry.id);
        continue; // pause check at top of loop handles sleeping
      }

      // API errors count toward circuit breaker
      if (err.code === 'API_ERROR') {
        consecutiveApiFailures++;
        if (consecutiveApiFailures >= MAX_CONSECUTIVE_API_FAILURES) {
          consecutiveApiFailures = 0;
          pauseUntil = Date.now() + PAUSE_MS;
          console.warn('[extract-queue] 10 consecutive API failures — pausing 30min');
          db.prepare("UPDATE extract_queue SET status='pending', last_error=? WHERE id=?").run(err.message, entry.id);
          continue;
        }
      }

      // Item exhausted its retries
      if (attempt >= MAX_ITEM_ATTEMPTS) {
        consecutiveItemFailures++;
        db.prepare("UPDATE extract_queue SET status='failed', last_error=? WHERE id=?").run(err.message, entry.id);
        console.warn(`[extract-queue] w${workerId}: item ${entry.item_id} failed permanently: ${err.message}`);
        if (consecutiveItemFailures >= MAX_CONSECUTIVE_ITEM_FAILURES) {
          consecutiveItemFailures = 0;
          pauseUntil = Date.now() + PAUSE_MS;
          console.warn('[extract-queue] 3 consecutive item failures — pausing 30min');
          continue;
        }
      } else {
        // Exponential backoff: 2 → 4 → 8 min, capped at 30
        const backoffMins = Math.min(Math.pow(2, attempt), 30);
        db.prepare(`
          UPDATE extract_queue SET status='pending', last_error=?,
            next_attempt_at=datetime('now', '+${backoffMins} minutes')
          WHERE id=?
        `).run(err.message, entry.id);
        console.warn(`[extract-queue] w${workerId}: item ${entry.item_id} retry in ${backoffMins}min — ${err.message}`);
      }
    }
    // No delay here: immediately claim the next item if one is available
  }
}

// --- Lifecycle ---

function startQueue() {
  if (running) return;
  running = true;

  const db = getDb();
  const reset = db.prepare("UPDATE extract_queue SET status='pending' WHERE status='processing'").run();
  if (reset.changes > 0) console.log(`[extract-queue] reset ${reset.changes} stuck item(s)`);

  console.log(`[extract-queue] starting ${CONCURRENCY} worker(s)`);
  for (let i = 0; i < CONCURRENCY; i++) {
    // Stagger starts slightly so workers don't all hit the DB simultaneously
    setTimeout(() => runWorker(i), i * 300 + 1000);
  }
}

function stopQueue() {
  running = false;
  // Workers exit naturally on their next loop iteration
}

function getQueueStatus() {
  const paused = !!(pauseUntil && Date.now() < pauseUntil);
  const pauseMinutesLeft = paused ? Math.ceil((pauseUntil - Date.now()) / 60000) : 0;
  return { paused, pauseMinutesLeft, concurrency: CONCURRENCY };
}

function restartFailed() {
  const result = getDb().prepare(`
    UPDATE extract_queue
    SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = datetime('now')
    WHERE status = 'failed'
  `).run();
  return result.changes;
}

module.exports = { enqueue, reEnqueue, getQueueEntry, getQueueStatus, startQueue, stopQueue, restartFailed };
