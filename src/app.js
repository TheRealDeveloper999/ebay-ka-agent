'use strict';

const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const { formatPrice, formatDate, relativeTime, changeTypeLabel, changeTypeBadgeClass } = require('./lib/formatters');

const app = express();

// Template engine
const env = nunjucks.configure(path.join(__dirname, '../views'), {
  autoescape: true,
  express: app,
  watch: false,
});

env.addGlobal('formatPrice', formatPrice);
env.addGlobal('formatDate', formatDate);
env.addGlobal('relativeTime', relativeTime);
env.addGlobal('changeTypeLabel', changeTypeLabel);
env.addGlobal('changeTypeBadgeClass', changeTypeBadgeClass);

app.set('view engine', 'njk');

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Flash messages via query params (simple, no sessions needed)
app.use((req, res, next) => {
  res.locals.flash = req.query.flash || null;
  res.locals.flashType = req.query.flashType || 'success';
  next();
});

// Routes
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/sources'));
app.use('/', require('./routes/items'));

// 404
app.use((req, res) => {
  res.status(404).render('404.njk', { page: '' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  const isHtmx = req.headers['hx-request'];
  if (isHtmx) {
    return res.status(500).send(`<p class="error">Fehler: ${err.message}</p>`);
  }
  res.status(500).render('error.njk', { error: err, page: '' });
});

module.exports = app;
