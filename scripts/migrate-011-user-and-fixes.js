
// scripts/migrate-011-user-and-fixes.js
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DB_FILE = process.env.DB_FILE || path.resolve('./data/app.db');

function log(msg){ console.log('[migrate-011]', msg); }

function hasColumn(rows, name){
  return rows.some(r => (r.name||'').toLowerCase() === name.toLowerCase());
}

async function addColumnIfMissing(db, table, columnDef){
  const cols = await db.all(`PRAGMA table_info(${table})`);
  const name = columnDef.split(/\s+/)[0];
  if (!hasColumn(cols, name)){
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    log(`Added ${table}.${name}`);
  } else {
    log(`OK ${table}.${name}`);
  }
}

(async ()=>{
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  log(`Using DB: ${DB_FILE}`);

  // users: avatar_path, session_version
  await addColumnIfMissing(db, 'users', 'avatar_path TEXT');
  await addColumnIfMissing(db, 'users', 'session_version INTEGER DEFAULT 1');

  // pages_translations: full_path
  await addColumnIfMissing(db, 'pages_translations', 'full_path TEXT');

  // categories_translations: full_path
  await addColumnIfMissing(db, 'categories_translations', 'full_path TEXT');

  log('Done.');
  await db.close();
})().catch(e=>{ console.error(e); process.exit(1); });
