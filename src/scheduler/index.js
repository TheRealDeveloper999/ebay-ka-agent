'use strict';

const cron = require('node-cron');
const { getDb } = require('../db');
const { scrapeSource } = require('../scraper');
const { acquire, ping, complete, PING_INTERVAL_MS } = require('../scraper/locks');

const MIN_INTERVAL = parseInt(process.env.MIN_SCRAPE_INTERVAL_MINUTES || '5', 10);
const jobs = new Map();

function buildCronExpr(intervalMinutes) {
  const safe = Math.max(intervalMinutes, MIN_INTERVAL);
  return `*/${safe} * * * *`;
}

function addJob(source) {
  if (jobs.has(source.id)) removeJob(source.id);
  const expr = buildCronExpr(source.interval);
  const task = cron.schedule(expr, async () => {
    if (!acquire(source.id)) {
      console.log(`[scheduler] source ${source.id} scrape still running, skipping tick`);
      return;
    }
    console.log(`[scheduler] Scraping source ${source.id} (${source.name})`);
    const pingInterval = setInterval(() => ping(source.id), PING_INTERVAL_MS);
    try {
      const stats = await scrapeSource(source.id);
      complete(source.id, stats, null);
      console.log(`[scheduler] Source ${source.id} done:`, stats);
    } catch (err) {
      complete(source.id, null, err.message);
      console.error(`[scheduler] Source ${source.id} error:`, err.message);
    } finally {
      clearInterval(pingInterval);
    }
  });
  jobs.set(source.id, task);
  console.log(`[scheduler] Scheduled source ${source.id} every ${Math.max(source.interval, MIN_INTERVAL)} min`);
}

function removeJob(id) {
  const task = jobs.get(id);
  if (task) {
    task.stop();
    jobs.delete(id);
  }
}

function restartJob(source) {
  removeJob(source.id);
  if (source.active) addJob(source);
}

function initScheduler() {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM sources WHERE active = 1').all();
  for (const source of sources) {
    addJob(source);
  }
  console.log(`[scheduler] Initialized with ${sources.length} active source(s)`);
}

module.exports = { initScheduler, addJob, removeJob, restartJob };
