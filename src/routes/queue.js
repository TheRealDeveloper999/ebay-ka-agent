'use strict';

const express = require('express');
const { getDb } = require('../db');
const { getQueueStatus, restartFailed } = require('../lib/extract-queue');
const { getKeyStatuses } = require('../lib/extractor');
const router = express.Router();

function getQueueCounts(db) {
  const rows = db.prepare('SELECT status, COUNT(*) as n FROM extract_queue GROUP BY status').all();
  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

function getRecentItems(db, limit = 30) {
  return db.prepare(`
    SELECT eq.*, i.title
    FROM extract_queue eq
    JOIN items i ON i.id = eq.item_id
    ORDER BY eq.created_at DESC
    LIMIT ?
  `).all(limit);
}

router.get('/queue', (req, res) => {
  const db = getDb();
  const counts = getQueueCounts(db);
  const { paused, pauseMinutesLeft, concurrency } = getQueueStatus();
  const items = getRecentItems(db);
  const keys = getKeyStatuses();
  res.render('queue.njk', { counts, paused, pauseMinutesLeft, concurrency, items, keys, page: 'queue' });
});

router.get('/queue/stats', (req, res) => {
  const db = getDb();
  const counts = getQueueCounts(db);
  const { paused, pauseMinutesLeft, concurrency } = getQueueStatus();
  const items = getRecentItems(db);
  const keys = getKeyStatuses();
  res.render('partials/queue-stats.njk', { counts, paused, pauseMinutesLeft, concurrency, items, keys });
});

router.post('/queue/:id/reset-attempts', (req, res) => {
  getDb().prepare(`
    UPDATE extract_queue SET attempts = 0, status = 'pending', last_error = NULL, next_attempt_at = datetime('now')
    WHERE id = ? AND status != 'processing'
  `).run(req.params.id);
  const db = getDb();
  const counts = getQueueCounts(db);
  const { paused, pauseMinutesLeft, concurrency } = getQueueStatus();
  const items = getRecentItems(db);
  const keys = getKeyStatuses();
  res.render('partials/queue-stats.njk', { counts, paused, pauseMinutesLeft, concurrency, items, keys });
});

router.post('/queue/restart-failed', (req, res) => {
  const changed = restartFailed();
  const db = getDb();
  const counts = getQueueCounts(db);
  const { paused, pauseMinutesLeft, concurrency } = getQueueStatus();
  const items = getRecentItems(db);
  const keys = getKeyStatuses();
  res.render('partials/queue-stats.njk', { counts, paused, pauseMinutesLeft, concurrency, items, keys });
});

router.get('/queue/graph-data', (req, res) => {
  const db = getDb();
  const counts = getQueueCounts(db);
  const { paused, pauseMinutesLeft, concurrency } = getQueueStatus();
  const keys = getKeyStatuses();
  res.json({ ...counts, paused, pauseMinutesLeft, keys });
});

module.exports = router;
