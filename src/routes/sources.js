'use strict';

const express = require('express');
const { getDb } = require('../db');
const { scrapeSource } = require('../scraper');
const { restartJob, removeJob, addJob } = require('../scheduler');
const { acquire, ping, complete, getJob, clear, PING_INTERVAL_MS } = require('../scraper/locks');
const { parseOptionalFloat, validateSource } = require('../lib/source-validation');
const router = express.Router();

router.get('/sources', (req, res) => {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  res.render('sources-list.njk', { sources, page: 'sources' });
});

router.get('/sources/new', (req, res) => {
  res.render('source-form.njk', { source: {}, errors: [], page: 'sources', action: '/sources', method: 'POST', title: 'New source' });
});

router.post('/sources', (req, res) => {
  const body = req.body ?? {};
  const errors = validateSource(body);
  if (errors.length) {
    return res.render('source-form.njk', { source: body, errors, page: 'sources', action: '/sources', method: 'POST', title: 'New source' });
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sources (name, url, interval, active, keyword, min_price, max_price)
    VALUES (@name, @url, @interval, @active, @keyword, @min_price, @max_price)
  `).run({
    name: body.name.trim(),
    url: body.url.trim(),
    interval: parseInt(body.interval, 10),
    active: body.active === 'on' ? 1 : 0,
    keyword: body.keyword?.trim() || null,
    min_price: parseOptionalFloat(body.min_price),
    max_price: parseOptionalFloat(body.max_price),
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
  const body = req.body ?? {};
  const errors = validateSource(body);
  if (errors.length) {
    const db = getDb();
    const source = { ...db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id), ...body };
    return res.render('source-form.njk', { source, errors, page: 'sources', action: `/sources/${req.params.id}`, method: 'POST', title: 'Edit source' });
  }
  const db = getDb();
  db.prepare(`
    UPDATE sources SET name=@name, url=@url, interval=@interval, active=@active,
      keyword=@keyword, min_price=@min_price, max_price=@max_price, updated_at=datetime('now')
    WHERE id=@id
  `).run({
    id: req.params.id,
    name: body.name.trim(),
    url: body.url.trim(),
    interval: parseInt(body.interval, 10),
    active: body.active === 'on' ? 1 : 0,
    keyword: body.keyword?.trim() || null,
    min_price: parseOptionalFloat(body.min_price),
    max_price: parseOptionalFloat(body.max_price),
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
