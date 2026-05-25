'use strict';

const express = require('express');
const { getDb } = require('../db');
const router = express.Router();

function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) as n FROM items WHERE removed_at IS NULL').get().n;
  const newToday = db.prepare("SELECT COUNT(*) as n FROM items WHERE date(first_seen_at) = date('now') AND removed_at IS NULL").get().n;
  const changedToday = db.prepare("SELECT COUNT(DISTINCT item_id) as n FROM changes WHERE date(detected_at) = date('now') AND change_type != 'new'").get().n;
  const activeSources = db.prepare('SELECT COUNT(*) as n FROM sources WHERE active = 1').get().n;
  return { total, newToday, changedToday, activeSources };
}

function getRecentChanges(db, limit = 20) {
  return db.prepare(`
    SELECT c.*, i.title, i.url as item_url, i.thumbnail_url, i.price_text, s.name as source_name
    FROM changes c
    JOIN items i ON c.item_id = i.id
    JOIN sources s ON c.source_id = s.id
    ORDER BY c.detected_at DESC
    LIMIT ?
  `).all(limit);
}

function getRecentItems(db, limit = 12) {
  return db.prepare(`
    SELECT i.*, s.name as source_name
    FROM items i
    JOIN sources s ON i.source_id = s.id
    WHERE i.removed_at IS NULL
    ORDER BY i.first_seen_at DESC
    LIMIT ?
  `).all(limit);
}

router.get('/', (req, res) => {
  const db = getDb();
  res.render('dashboard.njk', {
    stats: getStats(db),
    changes: getRecentChanges(db),
    recentItems: getRecentItems(db),
    page: 'dashboard',
  });
});

router.get('/dashboard/stats', (req, res) => {
  const db = getDb();
  res.render('partials/stats-cards.njk', { stats: getStats(db) });
});

router.get('/dashboard/changes', (req, res) => {
  const db = getDb();
  res.render('partials/changes-feed.njk', { changes: getRecentChanges(db) });
});

module.exports = router;
