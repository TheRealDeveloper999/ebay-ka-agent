'use strict';

require('dotenv').config();
const { migrate } = require('../db/migrate');
const { scrapeSource } = require('./index');
const { closeBrowser } = require('./browser');

const sourceId = parseInt(process.argv[2], 10);
if (!sourceId) {
  console.error('Usage: node src/scraper/cli.js <sourceId>');
  process.exit(1);
}

migrate();
scrapeSource(sourceId)
  .then(stats => {
    console.log('Scrape complete:', stats);
    process.exit(0);
  })
  .catch(err => {
    console.error('Scrape failed:', err);
    process.exit(1);
  })
  .finally(() => closeBrowser());
