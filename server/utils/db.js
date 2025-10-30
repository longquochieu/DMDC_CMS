// server/utils/db.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const DB_PATH = process.env.DB_PATH || process.env.DB_FILE || './data/app.db';

function ensureDir(p) {
  const dir = path.dirname(path.resolve(p));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let _dbPromise = null;

export async function getDb() {
  if (_dbPromise) return _dbPromise;

  ensureDir(DB_PATH);
  _dbPromise = open({ filename: DB_PATH, driver: sqlite3.Database })
    .then(async (db) => {
      await db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
      `);
      return db;
    });

  return _dbPromise;
}
