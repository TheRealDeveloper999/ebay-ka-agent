'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { diffSnapshots } = require('../src/scraper/differ');

// Helpers
function makeSnap(overrides = {}) {
  return {
    title: 'Gaming PC RTX 3070',
    price: 800,
    location: 'Berlin',
    description: 'A great gaming PC',
    seller_name: 'max_seller',
    ...overrides,
  };
}

// ── No previous snapshot ──────────────────────────────────────────────────────

describe('diffSnapshots — first seen (no previous snapshot)', () => {
  test('null prev returns single new change', () => {
    const changes = diffSnapshots(null, makeSnap());
    assert.equal(changes.length, 1);
    assert.equal(changes[0].change_type, 'new');
  });

  test('new change has null field_name, old_value, new_value', () => {
    const changes = diffSnapshots(null, makeSnap());
    const [c] = changes;
    assert.equal(c.field_name, null);
    assert.equal(c.old_value, null);
    assert.equal(c.new_value, null);
  });
});

// ── Unchanged snapshots ───────────────────────────────────────────────────────

describe('diffSnapshots — no changes when tracked fields are identical', () => {
  test('identical snapshots produce empty change array', () => {
    const snap = makeSnap();
    const changes = diffSnapshots(snap, { ...snap });
    assert.equal(changes.length, 0);
  });

  test('only untracked fields differ → no changes', () => {
    const prev = makeSnap({ extra_field: 'ignored' });
    const next = makeSnap({ extra_field: 'also ignored' });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 0);
  });
});

// ── Price changes ─────────────────────────────────────────────────────────────

describe('diffSnapshots — price_drop', () => {
  test('numeric price decrease produces price_drop', () => {
    const prev = makeSnap({ price: 1000 });
    const next = makeSnap({ price: 800 });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].change_type, 'price_drop');
  });

  test('price_drop carries old and new values as strings', () => {
    const prev = makeSnap({ price: 1000 });
    const next = makeSnap({ price: 800 });
    const [c] = diffSnapshots(prev, next);
    assert.equal(c.field_name, 'price');
    assert.equal(c.old_value, '1000');
    assert.equal(c.new_value, '800');
  });

  test('price_drop with float prices', () => {
    const prev = makeSnap({ price: 999.99 });
    const next = makeSnap({ price: 749.99 });
    const [c] = diffSnapshots(prev, next);
    assert.equal(c.change_type, 'price_drop');
  });
});

describe('diffSnapshots — price_rise', () => {
  test('numeric price increase produces price_rise', () => {
    const prev = makeSnap({ price: 800 });
    const next = makeSnap({ price: 1000 });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].change_type, 'price_rise');
  });

  test('price_rise carries old and new values as strings', () => {
    const prev = makeSnap({ price: 800 });
    const next = makeSnap({ price: 1000 });
    const [c] = diffSnapshots(prev, next);
    assert.equal(c.old_value, '800');
    assert.equal(c.new_value, '1000');
  });

  test('null field replaced by numeric value produces price_rise', () => {
    // null → 500: old price is null (non-numeric), new price is 500.
    // Since the old side is not a valid number the drop/rise comparison is
    // inconclusive, so the differ falls back to price_rise.
    const prev = makeSnap({ price: null });
    const next = makeSnap({ price: 500 });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].change_type, 'price_rise');
    assert.equal(changes[0].old_value, null);
    assert.equal(changes[0].new_value, '500');
  });

  test('same price — no change', () => {
    const prev = makeSnap({ price: 800 });
    const next = makeSnap({ price: 800 });
    assert.equal(diffSnapshots(prev, next).length, 0);
  });
});

// ── String field changes ──────────────────────────────────────────────────────

describe('diffSnapshots — non-price field changes', () => {
  test('title change produces title_changed', () => {
    const prev = makeSnap({ title: 'Old Title' });
    const next = makeSnap({ title: 'New Title' });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].change_type, 'title_changed');
    assert.equal(changes[0].field_name, 'title');
    assert.equal(changes[0].old_value, 'Old Title');
    assert.equal(changes[0].new_value, 'New Title');
  });

  test('location change produces location_changed', () => {
    const prev = makeSnap({ location: 'Berlin' });
    const next = makeSnap({ location: 'Hamburg' });
    const [c] = diffSnapshots(prev, next);
    assert.equal(c.change_type, 'location_changed');
    assert.equal(c.field_name, 'location');
  });

  test('description change produces description_changed', () => {
    const prev = makeSnap({ description: 'Old desc' });
    const next = makeSnap({ description: 'New desc' });
    const [c] = diffSnapshots(prev, next);
    assert.equal(c.change_type, 'description_changed');
  });

  test('seller_name change produces seller_name_changed', () => {
    const prev = makeSnap({ seller_name: 'alice' });
    const next = makeSnap({ seller_name: 'bob' });
    const [c] = diffSnapshots(prev, next);
    assert.equal(c.change_type, 'seller_name_changed');
  });

  test('null to string transition is captured', () => {
    // null stringified is null; non-null is String(val)
    // If prev has null location and next has a real location, it's a change
    const prev = makeSnap({ location: null });
    const next = makeSnap({ location: 'Munich' });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].field_name, 'location');
    assert.equal(changes[0].old_value, null);
    assert.equal(changes[0].new_value, 'Munich');
  });

  test('string to null transition is captured', () => {
    const prev = makeSnap({ seller_name: 'alice' });
    const next = makeSnap({ seller_name: null });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].old_value, 'alice');
    assert.equal(changes[0].new_value, null);
  });

  test('multiple fields changed produces multiple change entries', () => {
    const prev = makeSnap({ title: 'Old Title', price: 800, location: 'Berlin' });
    const next = makeSnap({ title: 'New Title', price: 600, location: 'Hamburg' });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 3);
    const types = changes.map(c => c.change_type).sort();
    assert.deepEqual(types, ['location_changed', 'price_drop', 'title_changed'].sort());
  });

  test('numeric source value compared to equal string produces no diff', () => {
    // A field stored as the number 1 and a field stored as the string '1' represent
    // the same value after String() coercion.  diffSnapshots must not emit a spurious
    // change when the stringified forms are equal.
    const prev = makeSnap({ title: 1 });
    const next = makeSnap({ title: '1' });
    const changes = diffSnapshots(prev, next);
    assert.equal(changes.length, 0, 'numeric 1 vs string "1" should not produce a diff');
  });
});
