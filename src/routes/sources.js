'use strict';

const express = require('express');
const { getDb } = require('../db');
const { scrapeSource } = require('../scraper');
const { restartJob, removeJob, addJob } = require('../scheduler');
const router = express.Router();

function validateSource(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('Name ist erforderlich');
  if (!body.url || !body.url.trim()) errors.push('URL ist erforderlich');
  if (body.url && !body.url.includes('kleinanzeigen.de')) errors.push('URL muss kleinanzeigen.de enthalten');
  const interval = parseInt(body.interval, 10);
  if (isNaN(interval) || interval < 5) errors.push('Intervall muss mindestens 5 Minuten betragen');
  return errors;
}

router.get('/sources', (req, res) => {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  res.render('sources-list.njk', { sources, page: 'sources' });
});

router.get('/sources/new', (req, res) => {
  res.render('source-form.njk', { source: {}, errors: [], page: 'sources', action: '/sources', method: 'POST', title: 'Neue Quelle' });
});

router.post('/sources', (req, res) => {
  const errors = validateSource(req.body);
  if (errors.length) {
    return res.render('source-form.njk', { source: req.body, errors, page: 'sources', action: '/sources', method: 'POST', title: 'Neue Quelle' });
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sources (name, url, interval, active, keyword, min_price, max_price)
    VALUES (@name, @url, @interval, @active, @keyword, @min_price, @max_price)
  `).run({
    name: req.body.name.trim(),
    url: req.body.url.trim(),
    interval: parseInt(req.body.interval, 10),
    active: req.body.active === 'on' ? 1 : 0,
    keyword: req.body.keyword?.trim() || null,
    min_price: parseFloat(req.body.min_price) || null,
    max_price: parseFloat(req.body.max_price) || null,
  });
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
  if (source.active) addJob(source);
  res.redirect('/sources');
});

router.get('/sources/:id/edit', (req, res) => {
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).send('Not found');
  res.render('source-form.njk', { source, errors: [], page: 'sources', action: `/sources/${source.id}`, method: 'POST', title: 'Quelle bearbeiten' });
});

router.post('/sources/:id', (req, res) => {
  const errors = validateSource(req.body);
  if (errors.length) {
    const db = getDb();
    const source = { ...db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id), ...req.body };
    return res.render('source-form.njk', { source, errors, page: 'sources', action: `/sources/${req.params.id}`, method: 'POST', title: 'Quelle bearbeiten' });
  }
  const db = getDb();
  db.prepare(`
    UPDATE sources SET name=@name, url=@url, interval=@interval, active=@active,
      keyword=@keyword, min_price=@min_price, max_price=@max_price, updated_at=datetime('now')
    WHERE id=@id
  `).run({
    id: req.params.id,
    name: req.body.name.trim(),
    url: req.body.url.trim(),
    interval: parseInt(req.body.interval, 10),
    active: req.body.active === 'on' ? 1 : 0,
    keyword: req.body.keyword?.trim() || null,
    min_price: parseFloat(req.body.min_price) || null,
    max_price: parseFloat(req.body.max_price) || null,
  });
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  restartJob(source);
  res.redirect('/sources');
});

router.patch('/sources/:id/toggle', (req, res) => {
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).send('Not found');
  const newActive = source.active ? 0 : 1;
  db.prepare("UPDATE sources SET active=?, updated_at=datetime('now') WHERE id=?").run(newActive, source.id);
  const updated = db.prepare('SELECT * FROM sources WHERE id = ?').get(source.id);
  if (newActive) addJob(updated); else removeJob(source.id);
  res.render('partials/source-row.njk', { source: updated });
});

router.delete('/sources/:id', (req, res) => {
  const db = getDb();
  removeJob(parseInt(req.params.id, 10));
  db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id);
  res.status(200).send('');
});

router.post('/sources/:id/scrape', async (req, res) => {
  try {
    const stats = await scrapeSource(parseInt(req.params.id, 10));
    const db = getDb();
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    res.render('partials/scrape-status.njk', { source, stats, error: null });
  } catch (err) {
    const db = getDb();
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    res.render('partials/scrape-status.njk', { source, stats: null, error: err.message });
  }
});

module.exports = router;
