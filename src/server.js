'use strict';

require('dotenv').config();

const { migrate } = require('./db/migrate');
const { closeDb } = require('./db');
const { closeBrowser } = require('./scraper/browser');
const { initScheduler } = require('./scheduler');
const { startQueue, stopQueue } = require('./lib/extract-queue');
const log = require('./lib/logger');
const app = require('./app');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ENV = process.env.NODE_ENV || 'development';

migrate();
initScheduler();
startQueue();

const server = app.listen(PORT, () => {
  log.log(`eBay KA Agent (${ENV}) listening on http://localhost:${PORT}`);
});

async function shutdown(signal) {
  log.log(`${signal} received — shutting down`);
  stopQueue();
  server.close();
  await closeBrowser();
  closeDb();
  log.log('Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
