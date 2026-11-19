'use strict';

const express = require('express');
const { getDb } = require('../db');
const { attachItemImages } = require('../lib/item-images');
const { getListingAge } = require('../lib/listing-age');
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
    WHERE i.is_hidden = 0
    ORDER BY c.detected_at DESC
    LIMIT ?
  `).all(limit);
}

const PAGE_SIZE = 25;

function getRecentItems(db, sort = 'score', page = 1) {
  const orderBy = sort === 'score'
    ? 'i.score DESC NULLS LAST, i.first_seen_at DESC'
    : 'i.first_seen_at DESC';
  const offset = (page - 1) * PAGE_SIZE;
  const total = db.prepare('SELECT COUNT(*) as n FROM items WHERE removed_at IS NULL AND is_hidden = 0').get().n;
  const items = db.prepare(`
    SELECT i.id, i.source_id, i.url, i.title, i.price, i.price_text,
           i.location, i.thumbnail_url, i.image_urls, i.first_seen_at, i.ad_created_date, i.score, i.specs,
           s.name as source_name, eq.status as queue_status
    FROM items i
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN extract_queue eq ON eq.item_id = i.id
    WHERE i.removed_at IS NULL AND i.is_hidden = 0
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(PAGE_SIZE, offset);
  const now = new Date();
  const cards = attachItemImages(items).map(item => ({
    ...item,
    age: getListingAge(item.ad_created_date, now),
  }));
  return { items: cards, total, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

router.get('/', (req, res) => {
  const db = getDb();
  const sort = req.query.sort === 'date' ? 'date' : 'score';
  const pageNum = Math.max(1, parseInt(req.query.page || '1', 10));
  const { items, total, page, totalPages } = getRecentItems(db, sort, pageNum);
  const anyPending = items.some(it => it.queue_status === 'pending' || it.queue_status === 'processing');
  res.render('dashboard.njk', {
    stats: getStats(db),
    changes: getRecentChanges(db),
    recentItems: items,
    sort,
    anyPending,
    currentPage: page,
    totalPages,
    total,
    page: 'dashboard',
  });
});

router.get('/dashboard/stats', (req, res) => {
  const db = getDb();
  res.render('partials/stats-cards-inner.njk', { stats: getStats(db) });
});

router.get('/changes', (req, res) => {
  const db = getDb();
  res.render('changes.njk', { changes: getRecentChanges(db, 100), page: 'changes' });
});

router.get('/dashboard/changes', (req, res) => {
  const db = getDb();
  res.render('partials/changes-feed.njk', { changes: getRecentChanges(db) });
});

router.get('/dashboard/items', (req, res) => {
  const db = getDb();
  const sort = req.query.sort === 'date' ? 'date' : 'score';
  const pageNum = Math.max(1, parseInt(req.query.page || '1', 10));
  const { items, total, page, totalPages } = getRecentItems(db, sort, pageNum);
  const anyPending = items.some(it => it.queue_status === 'pending' || it.queue_status === 'processing');
  res.render('partials/items-grid.njk', { recentItems: items, sort, anyPending, currentPage: page, totalPages, total });
});

module.exports = router;
