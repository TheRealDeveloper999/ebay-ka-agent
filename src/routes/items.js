'use strict';

const express = require('express');
const { getDb } = require('../db');
const router = express.Router();

router.get('/items/:id', (req, res) => {
  const db = getDb();
  const item = db.prepare(`
    SELECT i.*, s.name as source_name, s.url as source_url
    FROM items i JOIN sources s ON i.source_id = s.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!item) return res.status(404).render('404.njk', { page: '' });

  item.image_urls_parsed = item.image_urls ? JSON.parse(item.image_urls) : [];

  const snapshots = db.prepare('SELECT * FROM snapshots WHERE item_id = ? ORDER BY scraped_at DESC').all(item.id);
  const changes = db.prepare(`
    SELECT * FROM changes WHERE item_id = ? ORDER BY detected_at DESC
  `).all(item.id);

  res.render('item-detail.njk', { item, snapshots, changes, page: '' });
});

router.get('/items/:id/changes', (req, res) => {
  const db = getDb();
  const changes = db.prepare('SELECT * FROM changes WHERE item_id = ? ORDER BY detected_at DESC').all(req.params.id);
  res.render('partials/changes-feed.njk', { changes, itemView: true });
});

module.exports = router;
