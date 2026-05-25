'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH || './data/ka-agent.db');

let _db;

function getDb() {
  if (!_db) {
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { getDb, closeDb };
