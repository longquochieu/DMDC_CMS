// server/utils/db.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
dotenv.config();

// Ưu tiên DB_PATH, rơi về DB_FILE, mặc định ./data/app.db
const DB_PATH = process.env.DB_PATH || process.env.DB_FILE || './data/app.db';

function wrapDbErrorLogging(db) {
  const orig = { all: db.all.bind(db), get: db.get.bind(db), run: db.run.bind(db) };
  for (const m of ['all','get','run']) {
    db[m] = async (sql, ...args) => {
      try { return await orig[m](sql, ...args); }
      catch (e) {
        console.error('[SQL ERROR]', m, '\nSQL:\n', sql, '\nARGS:', args, '\nMSG:', e.message);
        throw e;
      }
    };
  }
  return db;
}

export async function getDb() {
	const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
	if (!global.__loggedDbPath) { console.log('[DB] Using', DB_PATH); global.__loggedDbPath = true; }
	await db.exec("PRAGMA journal_mode=WAL;");
	await db.exec("PRAGMA busy_timeout=5000;");
  return wrapDbErrorLogging(db);
}
