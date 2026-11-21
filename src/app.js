'use strict';

const express = require('express');
const nunjucks = require('nunjucks');
const log = require('./lib/logger');
const path = require('path');
const { formatPrice, formatDate, formatCalendarDate, relativeTime, changeTypeLabel, changeTypeBadgeClass, queueStatusLabel, queueStatusBadgeClass } = require('./lib/formatters');
const { scoreLabel, specLine } = require('./lib/scorer');
const { isToday } = require('./lib/listing-age');

const DEV = process.env.NODE_ENV !== 'production';
const app = express();

// Template engine
const env = nunjucks.configure(path.join(__dirname, '../views'), {
  autoescape: true,
  express: app,
  watch: false,
  noCache: DEV,
});

env.addGlobal('formatPrice', formatPrice);
env.addGlobal('formatDate', formatDate);
env.addGlobal('formatCalendarDate', formatCalendarDate);
env.addGlobal('relativeTime', relativeTime);
env.addGlobal('isToday', isToday);
env.addGlobal('changeTypeLabel', changeTypeLabel);
env.addGlobal('changeTypeBadgeClass', changeTypeBadgeClass);
env.addGlobal('queueStatusLabel', queueStatusLabel);
env.addGlobal('queueStatusBadgeClass', queueStatusBadgeClass);
env.addGlobal('scoreLabel', scoreLabel);
env.addGlobal('specLine', specLine);
env.addGlobal('buildTs', Date.now());

app.set('view engine', 'njk');

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

if (DEV) require('./dev/hot-reload').mount(app);

// Flash messages via query params (simple, no sessions needed)
app.use((req, res, next) => {
  res.locals.flash = req.query.flash || null;
  res.locals.flashType = req.query.flashType || 'success';
  res.locals.devMode = DEV;
  next();
});

// Routes
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/sources'));
app.use('/', require('./routes/items'));
app.use('/', require('./routes/queue'));

// 404
app.use((req, res) => {
  res.status(404).render('404.njk', { page: '' });
});

const escHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Error handler
app.use((err, req, res, next) => {
  log.error(`${req.method} ${req.path} — ${err.message}`);
  if (err.stack) log.error(err.stack);
  const isHtmx = req.headers['hx-request'];
  if (isHtmx) {
    return res.status(500).send(`<p class="error">Error: ${escHtml(err.message)}</p>`);
  }
  res.status(500).render('error.njk', { error: err, page: '' });
});

module.exports = app;
