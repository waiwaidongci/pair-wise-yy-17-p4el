// 存储层：只负责 db.json 的读写与基础记录操作，不包含任何业务规则。
const fs = require('fs/promises');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const COLLECTIONS = ['sites', 'devices', 'calibrations', 'surveys'];

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  const db = JSON.parse(raw);
  for (const key of COLLECTIONS) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  return db;
}

async function writeDb(db) {
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2) + '\n');
  await fs.rename(tmp, DB_FILE);
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function stamp(action, note) {
  return { at: new Date().toISOString(), action, note: note || '' };
}

function find(db, collection, id) {
  return (db[collection] || []).find((entry) => entry.id === id) || null;
}

function sortNewest(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
}

module.exports = { readDb, writeDb, newId, stamp, find, sortNewest, COLLECTIONS };
