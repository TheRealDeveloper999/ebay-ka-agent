'use strict';

const express = require('express');
const { getDb } = require('../db');
const { scrapeSource } = require('../scraper');
const { restartJob, removeJob, addJob } = require('../scheduler');
const { acquire, ping, complete, getJob, clear, PING_INTERVAL_MS } = require('../scraper/locks');
const router = express.Router();

const ALLOWED_HOSTNAMES = new Set(['kleinanzeigen.de', 'www.kleinanzeigen.de', 'm.kleinanzeigen.de']);

function isAllowedUrl(raw) {
  try {
    const { protocol, hostname } = new URL(raw);
    return (protocol === 'http:' || protocol === 'https:') && ALLOWED_HOSTNAMES.has(hostname);
  } catch { return false; }
}

const parseOptionalFloat = v => (v !== '' && v != null) ? parseFloat(v) : null;

function validateSource(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('Name is required');
  if (!body.url || !body.url.trim()) errors.push('URL is required');
  if (body.url && !isAllowedUrl(body.url)) errors.push('URL must be a kleinanzeigen.de page (https://www.kleinanzeigen.de/...)');
  const interval = parseInt(body.interval, 10);
  if (isNaN(interval) || interval < 5) errors.push('Interval must be at least 5 minutes');
  if (!isNaN(interval) && interval > 1440) errors.push('Interval may not exceed 1440 minutes (24 h)');
  const min = parseOptionalFloat(body.min_price);
  const max = parseOptionalFloat(body.max_price);
  if (min !== null && isNaN(min)) errors.push('Min. price must be a number');
  if (max !== null && isNaN(max)) errors.push('Max. price must be a number');
  if (min !== null && max !== null && !isNaN(min) && !isNaN(max) && max < min)
    errors.push('Max. price must be greater than or equal to min. price');
  return errors;
}

router.get('/sources', (req, res) => {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  res.render('sources-list.njk', { sources, page: 'sources' });
});

router.get('/sources/new', (req, res) => {
  res.render('source-form.njk', { source: {}, errors: [], page: 'sources', action: '/sources', method: 'POST', title: 'New source' });
});

router.post('/sources', (req, res) => {
  const errors = validateSource(req.body);
  if (errors.length) {
    return res.render('source-form.njk', { source: req.body, errors, page: 'sources', action: '/sources', method: 'POST', title: 'New source' });
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
    min_price: parseOptionalFloat(req.body.min_price),
    max_price: parseOptionalFloat(req.body.max_price),
  });
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
  if (source.active) addJob(source);
  res.redirect('/sources');
});

router.get('/sources/:id/edit', (req, res) => {
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).send('Not found');
  res.render('source-form.njk', { source, errors: [], page: 'sources', action: `/sources/${source.id}`, method: 'POST', title: 'Edit source' });
});

router.post('/sources/:id', (req, res) => {
  const errors = validateSource(req.body);
  if (errors.length) {
    const db = getDb();
    const source = { ...db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id), ...req.body };
    return res.render('source-form.njk', { source, errors, page: 'sources', action: `/sources/${req.params.id}`, method: 'POST', title: 'Edit source' });
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
    min_price: parseOptionalFloat(req.body.min_price),
    max_price: parseOptionalFloat(req.body.max_price),
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

router.post('/sources/:id/scrape', (req, res) => {
  const sourceId = parseInt(req.params.id, 10);
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) return res.status(404).send('Not found');

  if (!acquire(sourceId)) {
    // Already running — return current status without starting another
    return res.render('partials/scrape-status.njk', { source, stats: null, error: null, running: true });
  }

  const pingInterval = setInterval(() => ping(sourceId), PING_INTERVAL_MS);
  scrapeSource(sourceId)
    .then(stats => complete(sourceId, stats, null))
    .catch(err  => complete(sourceId, null, err.message))
    .finally(()  => clearInterval(pingInterval));

  res.render('partials/scrape-status.njk', { source, stats: null, error: null, running: true });
});

router.get('/sources/:id/scrape-status', (req, res) => {
  const sourceId = parseInt(req.params.id, 10);
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) return res.status(404).send('Not found');

  const job = getJob(sourceId);
  if (!job || !job.done) {
    return res.render('partials/scrape-status.njk', { source, stats: null, error: null, running: true });
  }
  const { stats, error } = job;
  clear(sourceId);
  res.render('partials/scrape-status.njk', { source, stats, error, running: false });
});

module.exports = router;
