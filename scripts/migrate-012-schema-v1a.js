import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DB_FILE = process.env.DB_FILE || path.resolve('./data/app.db');
function log(msg){ console.log('[migrate-012]', msg); }
function hasColumn(cols, name){ return cols.some(c => (c.name||'').toLowerCase()===name.toLowerCase()); }
async function addColumnIfMissing(db, table, coldef){
  const cols = await db.all(`PRAGMA table_info(${table})`);
  const name = coldef.split(/\s+/)[0];
  if (!hasColumn(cols, name)){
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${coldef}`);
    log(`Added ${table}.${name}`);
  } else { log(`OK ${table}.${name}`); }
}
(async ()=>{
  if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  log(`Using DB: ${DB_FILE}`);
  await addColumnIfMissing(db, 'users', 'display_name TEXT');
  await addColumnIfMissing(db, 'users', 'avatar_path TEXT');
  await addColumnIfMissing(db, 'users', 'session_version INTEGER DEFAULT 1');
  await addColumnIfMissing(db, 'users', 'last_activity TEXT');
  await addColumnIfMissing(db, 'posts', 'featured_media_id INTEGER');
  await addColumnIfMissing(db, 'posts', 'primary_category_id INTEGER');
  await addColumnIfMissing(db, 'posts', 'display_date TEXT');
  await addColumnIfMissing(db, 'posts', 'scheduled_at TEXT');
  await addColumnIfMissing(db, 'posts', 'created_by INTEGER');
  await addColumnIfMissing(db, 'posts', 'updated_by INTEGER');
  await addColumnIfMissing(db, 'posts_translations', 'excerpt TEXT');
  await db.run(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  await db.run(`CREATE TABLE IF NOT EXISTS tags_translations (tag_id INTEGER, language TEXT, name TEXT, slug TEXT, PRIMARY KEY(tag_id, language))`);
  await db.run(`CREATE TABLE IF NOT EXISTS posts_tags (post_id INTEGER, tag_id INTEGER, PRIMARY KEY(post_id, tag_id))`);
  await db.run(`CREATE TABLE IF NOT EXISTS posts_categories (post_id INTEGER, category_id INTEGER, PRIMARY KEY(post_id, category_id))`);
  await db.run(`CREATE TABLE IF NOT EXISTS media_usages (post_id INTEGER, media_id INTEGER, field TEXT, position INTEGER DEFAULT 0)`);
  await addColumnIfMissing(db, 'pages_translations', 'full_path TEXT');
  await addColumnIfMissing(db, 'categories_translations', 'full_path TEXT');
  await db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  await db.run(`CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, meta TEXT, created_at TEXT DEFAULT (datetime('now')) )`);
  const defaults = [['max_image_size_mb','5'],['disk_alert_mb','500'],['ga4_measurement_id',''],['gsc_meta_tag','']];
  for (const [k,v] of defaults){
    await db.run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=COALESCE(value, excluded.value)`, k, v);
  }
  log('Done.');
  await db.close();
})().catch(e=>{ console.error(e); process.exit(1); });
