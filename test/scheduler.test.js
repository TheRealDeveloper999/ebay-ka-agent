'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  getEffectiveIntervalMinutes,
  getNextRunDelayMs,
  getNextRunAt,
} = require('../src/scheduler');

describe('scheduler interval anchoring', () => {
  test('references the source interval from last_scraped_at', () => {
    const source = { interval: 15, last_scraped_at: '2026-05-30T02:00:00.000Z' };
    const now = Date.parse('2026-05-30T02:05:00.000Z');

    assert.equal(getNextRunAt(source, now).toISOString(), '2026-05-30T02:15:00.000Z');
    assert.equal(getNextRunDelayMs(source, now), 10 * 60 * 1000);
  });

  test('due immediately when the interval has elapsed since last fetch', () => {
    const source = { interval: 15, last_scraped_at: '2026-05-30T02:00:00.000Z' };
    const now = Date.parse('2026-05-30T02:16:00.000Z');

    assert.equal(getNextRunAt(source, now).toISOString(), '2026-05-30T02:15:00.000Z');
    assert.equal(getNextRunDelayMs(source, now), 0);
  });

  test('runs immediately when no last fetch is logged yet', () => {
    const source = { interval: 15, last_scraped_at: null };
    const now = Date.parse('2026-05-30T02:05:00.000Z');

    assert.equal(getNextRunAt(source, now).toISOString(), '2026-05-30T02:05:00.000Z');
    assert.equal(getNextRunDelayMs(source, now), 0);
  });

  test('keeps the configured minimum interval floor', () => {
    assert.equal(getEffectiveIntervalMinutes({ interval: 1 }), 5);
  });
});
