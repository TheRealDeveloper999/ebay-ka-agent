'use strict';

const PING_INTERVAL_MS = 10_000;   // caller pings every 10s while scrape runs
const STALE_MS         = 120_000;  // lock is dead if no ping for 2 min

// sourceId → { startedAt, lastPingAt, stats, error, done }
const jobs = new Map();

function acquire(sourceId) {
  const existing = jobs.get(sourceId);
  if (existing && !existing.done) {
    const age = Date.now() - existing.lastPingAt;
    if (age < STALE_MS) return false; // still alive
    // No ping for ≥2 min — treat as crashed, allow a new run
    console.warn(`[locks] source ${sourceId} lock stale (${Math.round(age / 1000)}s since last ping) — clearing`);
  }
  jobs.set(sourceId, { startedAt: Date.now(), lastPingAt: Date.now(), stats: null, error: null, done: false });
  return true;
}

function ping(sourceId) {
  const job = jobs.get(sourceId);
  if (job && !job.done) job.lastPingAt = Date.now();
}

function complete(sourceId, stats, error) {
  const job = jobs.get(sourceId);
  if (job) jobs.set(sourceId, { ...job, stats, error, done: true });
}

function getJob(sourceId) {
  return jobs.get(sourceId) || null;
}

function clear(sourceId) {
  jobs.delete(sourceId);
}

function isRunning(sourceId) {
  const job = jobs.get(sourceId);
  if (!job || job.done) return false;
  if (Date.now() - job.startedAt >= STALE_MS) { jobs.delete(sourceId); return false; }
  return true;
}

module.exports = { acquire, ping, complete, getJob, clear, isRunning, PING_INTERVAL_MS };
