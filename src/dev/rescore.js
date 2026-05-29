'use strict';

require('dotenv').config();
const { getDb } = require('../db');
const { scoreItem } = require('../lib/scorer');

const db = getDb();

const items = db.prepare('SELECT id, specs FROM items WHERE specs IS NOT NULL').all();

const update = db.prepare('UPDATE items SET score = ? WHERE id = ?');

const rescore = db.transaction(() => {
  let updated = 0, skipped = 0;
  for (const { id, specs } of items) {
    let parsed;
    try { parsed = JSON.parse(specs); } catch { skipped++; continue; }
    const score = scoreItem(parsed);
    update.run(score, id);
    updated++;
  }
  return { updated, skipped };
});

const { updated, skipped } = rescore();
console.log(`Rescored ${updated} items (${skipped} skipped — invalid JSON).`);
