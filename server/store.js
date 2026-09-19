// 存储层：唯一接触 db.json 的地方。原子写入，mutate 保证读-改-写一致。

const fs = require('fs/promises');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');
const COLLECTIONS = ['sites', 'devices', 'calibrations', 'surveys'];

async function read() {
  let db;
  try {
    db = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = {};
  }
  for (const key of COLLECTIONS) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  return db;
}

async function write(db) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2) + '\n');
  await fs.rename(tmp, DB_FILE);
}

// fn 返回 { error } 时不落盘，保证失败操作不留半截状态
async function mutate(fn) {
  const db = await read();
  const result = await fn(db);
  if (!result || !result.error) await write(db);
  return result;
}

function stamp(action, note) {
  return { at: new Date().toISOString(), action, note: note || '' };
}

module.exports = { read, write, mutate, stamp, DB_FILE, COLLECTIONS };
