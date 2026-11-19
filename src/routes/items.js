'use strict';

const express = require('express');
const { getDb } = require('../db');
const { reEnqueue, getQueueEntry } = require('../lib/extract-queue');
const { scoreItem, scoreLabel } = require('../lib/scorer');
const { normalizeItemImages } = require('../lib/item-images');
const router = express.Router();

router.get('/items/:id', (req, res) => {
  const db = getDb();
  const item = db.prepare(`
    SELECT i.*, s.name as source_name, s.url as source_url
    FROM items i JOIN sources s ON i.source_id = s.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!item) return res.status(404).render('404.njk', { page: '' });

  item.image_urls_parsed = normalizeItemImages(item);
  item.specs_parsed = item.specs ? JSON.parse(item.specs) : null;

  const snapshots = db.prepare('SELECT * FROM snapshots WHERE item_id = ? ORDER BY scraped_at DESC').all(item.id);
  const changes = db.prepare('SELECT * FROM changes WHERE item_id = ? ORDER BY detected_at DESC').all(item.id);
  const queueEntry = getQueueEntry(item.id);

  res.render('item-detail.njk', { item, snapshots, changes, queueEntry, page: '' });
});

router.get('/items/:id/specs', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('Not found');

  item.specs_parsed = item.specs ? JSON.parse(item.specs) : null;
  const queueEntry = getQueueEntry(item.id);

  res.render('partials/item-specs.njk', { specs: item.specs_parsed, itemId: item.id, error: null, queueEntry });
});

router.post('/items/:id/extract', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('Not found');

  if (!item.description) {
    return res.render('partials/item-specs.njk', {
      specs: null, itemId: item.id, queueEntry: null,
      error: 'No description available — please scrape first.',
    });
  }

  reEnqueue(item.id);
  const queueEntry = getQueueEntry(item.id);
  const specs = item.specs ? JSON.parse(item.specs) : null;

  res.render('partials/item-specs.njk', { specs, itemId: item.id, error: null, queueEntry });
});

router.post('/items/:id/hide', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE items SET is_hidden = 1 WHERE id = ?').run(req.params.id);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  res.render('partials/item-hide-toggle.njk', { item });
});

router.post('/items/:id/unhide', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE items SET is_hidden = 0 WHERE id = ?').run(req.params.id);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  res.render('partials/item-hide-toggle.njk', { item });
});

router.get('/items/:id/changes', (req, res) => {
  const db = getDb();
  const changes = db.prepare('SELECT * FROM changes WHERE item_id = ? ORDER BY detected_at DESC').all(req.params.id);
  res.render('partials/changes-feed.njk', { changes, itemView: true });
});

module.exports = router;
