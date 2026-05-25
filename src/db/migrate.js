'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./index');

function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const db = getDb();
  db.exec(schema);
  console.log('Database migration complete');
}

module.exports = { migrate };
