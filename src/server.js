'use strict';

require('dotenv').config();

const { migrate } = require('./db/migrate');
const { closeDb } = require('./db');
const { closeBrowser } = require('./scraper/browser');
const { initScheduler } = require('./scheduler');
const { startQueue, stopQueue } = require('./lib/extract-queue');
const app = require('./app');

const PORT = parseInt(process.env.PORT || '3000', 10);

migrate();
initScheduler();
startQueue();

const server = app.listen(PORT, () => {
  console.log(`eBay KA Agent running at http://localhost:${PORT}`);
});

async function shutdown() {
  console.log('\nShutting down...');
  stopQueue();
  server.close();
  await closeBrowser();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
