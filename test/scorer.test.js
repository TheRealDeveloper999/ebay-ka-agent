'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGpu, scoreGpu, scoreItem, specLine } = require('../src/lib/scorer');

// ── normalizeGpu ─────────────────────────────────────────────────────────────

describe('normalizeGpu — brand/series stripping', () => {
  test('strips nvidia geforce prefix', () => {
    assert.equal(normalizeGpu('NVIDIA GeForce RTX 3070'), '3070');
  });

  test('strips amd radeon rx prefix', () => {
    assert.equal(normalizeGpu('AMD Radeon RX 6700 XT'), '6700 xt');
  });

  test('strips intel arc prefix — bare model remains (a770)', () => {
    // 'intel' and 'arc' are both stripped → '  a770' → 'a770'
    assert.equal(normalizeGpu('Intel Arc A770'), 'a770');
  });

  test('strips intel arc for a750', () => {
    assert.equal(normalizeGpu('Intel Arc A750'), 'a750');
  });

  test('handles lowercase input', () => {
    assert.equal(normalizeGpu('rtx 4090'), '4090');
  });

  test('handles GTX prefix', () => {
    assert.equal(normalizeGpu('GTX 1080 Ti'), '1080 ti');
  });

  test('inserts space between digits and ti: 1050ti → 1050 ti', () => {
    assert.equal(normalizeGpu('GTX 1050ti'), '1050 ti');
  });

  test('inserts space between digits and xt: RX6700xt → 6700 xt', () => {
    assert.equal(normalizeGpu('RX6700xt'), '6700 xt');
  });

  test('inserts space between digits and super', () => {
    assert.equal(normalizeGpu('RTX 2070super'), '2070 super');
  });

  test('handles rx prefix run-together: rx5700', () => {
    assert.equal(normalizeGpu('rx5700'), '5700');
  });

  test('strips standalone memory sizes that are NOT model-identifying', () => {
    // "32GB RAM" has no preceding GPU model number — the gb token is standalone → stripped
    assert.equal(normalizeGpu('32GB RAM'), 'ram');
  });

  test('preserves model-identifying 12gb variant of 3080', () => {
    // '12gb' immediately follows the GPU model number '3080', marking the 12 GB VRAM
    // variant. The normalizer must preserve it so scoreGpu can match the
    // '3080 12gb' key (score 70) instead of falling back to plain '3080' (score 66).
    assert.equal(normalizeGpu('RTX 3080 12GB'), '3080 12gb');
  });

  test('returns null for null input', () => {
    assert.equal(normalizeGpu(null), null);
  });

  test('returns null for empty string', () => {
    assert.equal(normalizeGpu(''), null);
  });

  test('returns null for brand-only string', () => {
    // "NVIDIA GeForce" normalises to '' → null
    assert.equal(normalizeGpu('NVIDIA GeForce'), null);
  });

  test('leaves vega intact after rx stripping', () => {
    // 'rx vega 64' → rx stripped → 'vega 64'
    assert.equal(normalizeGpu('RX Vega 64'), 'vega 64');
  });

  test('leaves r9 prefix intact (r9 is part of model name, not stripped)', () => {
    // 'amd radeon r9 390x' → 'amd' and 'radeon' stripped → 'r9 390x'
    assert.equal(normalizeGpu('AMD Radeon R9 390X'), 'r9 390x');
  });
});

// ── scoreGpu ─────────────────────────────────────────────────────────────────

describe('scoreGpu — lookup and longest-key-first match', () => {
  test('RTX 3060 Ti scores differently from RTX 3060', () => {
    const ti = scoreGpu('RTX 3060 Ti');
    const plain = scoreGpu('RTX 3060');
    assert.notEqual(ti, plain, 'Ti variant must have a different score than plain 3060');
    assert.equal(ti, 53);
    assert.equal(plain, 44);
  });

  test('longest key wins: 3060 ti (53) chosen over shorter 3060 (44)', () => {
    // Both '3060 ti' and '3060' are contained in the normalised string;
    // the longer key must win to give 53 instead of 44.
    assert.equal(scoreGpu('RTX 3060 Ti'), 53);
    assert.equal(scoreGpu('RTX 3060'), 44);
    assert.notEqual(scoreGpu('RTX 3060 Ti'), scoreGpu('RTX 3060'),
      '3060 Ti must score differently from plain 3060 to prove disambiguation');
  });

  test('RTX 3080 12GB scores 70 (not the plain 3080 score of 66)', () => {
    // Regression: normalizeGpu must preserve "12gb" so the '3080 12gb' key is
    // matched instead of falling back to the shorter '3080' key.
    assert.equal(scoreGpu('RTX 3080 12GB'), 70);
    assert.notEqual(scoreGpu('RTX 3080 12GB'), scoreGpu('RTX 3080'),
      '3080 12GB must score differently from plain 3080');
  });

  test('4080 super scores correctly', () => {
    assert.equal(scoreGpu('RTX 4080 SUPER'), 90);
  });

  test('4070 ti super scores correctly', () => {
    assert.equal(scoreGpu('RTX 4070 Ti Super'), 84);
  });

  test('intel arc a770 scores correctly (52)', () => {
    assert.equal(scoreGpu('Intel Arc A770'), 52);
  });

  test('intel arc b580 scores correctly (55)', () => {
    assert.equal(scoreGpu('Intel Arc B580'), 55);
  });

  test('AMD RX 6700 XT scores 52', () => {
    assert.equal(scoreGpu('AMD Radeon RX 6700 XT'), 52);
  });

  test('RTX 4090 scores 100', () => {
    assert.equal(scoreGpu('NVIDIA GeForce RTX 4090'), 100);
  });

  test('returns null for unknown GPU', () => {
    assert.equal(scoreGpu('Some Unknown GPU 9999'), null);
  });

  test('returns null for null input', () => {
    assert.equal(scoreGpu(null), null);
  });

  test('returns null for empty string', () => {
    assert.equal(scoreGpu(''), null);
  });
});

// ── scoreItem ─────────────────────────────────────────────────────────────────

describe('scoreItem — composed scoring', () => {
  test('returns null when specs is null', () => {
    assert.equal(scoreItem(null), null);
  });

  test('returns null when specs is empty object (no gpu field)', () => {
    assert.equal(scoreItem({}), null);
  });

  test('returns null when gpu is unknown/unrecognised', () => {
    assert.equal(scoreItem({ gpu: 'Integrated HD 630' }), null);
  });

  test('returns null when gpu field is null', () => {
    assert.equal(scoreItem({ gpu: null }), null);
  });

  test('returns null when gpu field is empty string', () => {
    assert.equal(scoreItem({ gpu: '' }), null);
  });

  test('base score equals GPU score when no bonuses apply', () => {
    // RTX 3070 = 58, no ram, no cpu → should be 58
    const score = scoreItem({ gpu: 'RTX 3070' });
    assert.equal(score, 58);
  });

  test('RAM bonus: 64GB adds +8', () => {
    const base = scoreItem({ gpu: 'RTX 3070' }); // 58
    const withRam = scoreItem({ gpu: 'RTX 3070', ram_gb: 64 });
    assert.equal(withRam, base + 8);
  });

  test('RAM bonus: 32GB adds +6', () => {
    const base = scoreItem({ gpu: 'RTX 3070' }); // 58
    const withRam = scoreItem({ gpu: 'RTX 3070', ram_gb: 32 });
    assert.equal(withRam, base + 6);
  });

  test('RAM bonus: 16GB adds +3', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withRam = scoreItem({ gpu: 'RTX 3070', ram_gb: 16 });
    assert.equal(withRam, base + 3);
  });

  test('RAM bonus: 8GB adds +1', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withRam = scoreItem({ gpu: 'RTX 3070', ram_gb: 8 });
    assert.equal(withRam, base + 1);
  });

  test('RAM bonus: less than 8GB adds nothing', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withRam = scoreItem({ gpu: 'RTX 3070', ram_gb: 4 });
    assert.equal(withRam, base);
  });

  test('CPU bonus: i9 adds +5', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'Intel Core i9-13900K' });
    assert.equal(withCpu, base + 5);
  });

  test('CPU bonus: Ryzen 9 adds +5', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'AMD Ryzen 9 5900X' });
    assert.equal(withCpu, base + 5);
  });

  test('CPU bonus: i7 adds +3', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'Intel Core i7-12700K' });
    assert.equal(withCpu, base + 3);
  });

  test('CPU bonus: Ryzen 7 adds +3', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'AMD Ryzen 7 5800X' });
    assert.equal(withCpu, base + 3);
  });

  test('CPU bonus: i5 adds +1', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'Intel Core i5-12600K' });
    assert.equal(withCpu, base + 1);
  });

  test('CPU bonus: Ryzen 5 adds +1', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'AMD Ryzen 5 5600X' });
    assert.equal(withCpu, base + 1);
  });

  test('CPU bonus: unknown CPU adds nothing', () => {
    const base = scoreItem({ gpu: 'RTX 3070' });
    const withCpu = scoreItem({ gpu: 'RTX 3070', cpu: 'Intel Celeron G5900' });
    assert.equal(withCpu, base);
  });

  test('score is capped at 110', () => {
    // RTX 4090 = 100, + 8 RAM + 5 CPU = 113 → capped at 110
    const score = scoreItem({ gpu: 'RTX 4090', ram_gb: 64, cpu: 'Intel Core i9-13900K' });
    assert.equal(score, 110);
  });

  test('combined RAM+CPU bonus accumulates correctly below cap', () => {
    // RTX 3070 = 58, +6 ram (32GB), +3 cpu (i7) = 67, within cap
    const score = scoreItem({ gpu: 'RTX 3070', ram_gb: 32, cpu: 'Intel Core i7-12700K' });
    assert.equal(score, 67);
  });
});

// ── specLine ─────────────────────────────────────────────────────────────────

describe('specLine — formatting', () => {
  test('formats specs object with all fields', () => {
    const result = specLine({ cpu: 'Intel Core i7-12700K', gpu: 'RTX 3070', ram_gb: 16 });
    // Should include cpu, gpu, ram — joined by ' | '
    assert.ok(result.includes('|'), 'should separate parts with |');
    assert.ok(result.includes('16 GB'), 'should include RAM');
    // cpu brand stripped to short form
    assert.ok(result.includes('i7-12700K'), 'should include CPU model');
    // gpu brand stripped
    assert.ok(result.includes('3070'), 'should include GPU model number');
  });

  test('parses valid JSON string and formats correctly', () => {
    const json = JSON.stringify({ cpu: 'Intel Core i5-12600K', gpu: 'RTX 3060', ram_gb: 16 });
    const result = specLine(json);
    assert.ok(result !== null);
    assert.ok(result.includes('16 GB'));
  });

  test('returns null for invalid JSON string', () => {
    assert.equal(specLine('{not valid json'), null);
  });

  test('returns null for null input', () => {
    assert.equal(specLine(null), null);
  });

  test('returns null for empty object', () => {
    assert.equal(specLine({}), null);
  });

  test('returns null for JSON string of empty object', () => {
    assert.equal(specLine('{}'), null);
  });

  test('handles object with only ram (no cpu, no gpu)', () => {
    // Only ram_gb present → parts = ['32 GB'] → returns non-null
    const result = specLine({ ram_gb: 32 });
    assert.equal(result, '32 GB');
  });

  test('handles object with only gpu', () => {
    const result = specLine({ gpu: 'RTX 3070' });
    assert.ok(result !== null);
    assert.ok(result.includes('3070'));
  });

  test('object with all null/falsy fields returns null', () => {
    assert.equal(specLine({ cpu: null, gpu: null, ram_gb: 0 }), null);
  });

  test('CPU brand stripping: Intel Core removed from label', () => {
    const result = specLine({ cpu: 'Intel Core i9-13900K' });
    assert.ok(!result.includes('Intel'), 'Intel brand should be stripped from display');
    assert.ok(result.includes('i9-13900K'));
  });

  test('GPU brand stripping: NVIDIA/GeForce removed from label', () => {
    const result = specLine({ gpu: 'NVIDIA GeForce RTX 4090' });
    assert.ok(!result.includes('NVIDIA'));
    assert.ok(!result.includes('GeForce'));
  });
});
