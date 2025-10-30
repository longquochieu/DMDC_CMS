const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const DB_FILE = process.env.DB_FILE || "./data/app.db";

const DDL = [
  // core
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'admin',
    status TEXT DEFAULT 'active',
    display_name TEXT,
    avatar_path TEXT,
    session_version INTEGER DEFAULT 1,
    last_activity TEXT,
    deleted_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`,

  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'draft',
    display_date TEXT,
    scheduled_at TEXT,
    featured_media_id INTEGER,
    primary_category_id INTEGER,
    created_by INTEGER,
    updated_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS posts_translations (
    post_id INTEGER,
    language TEXT,
    title TEXT,
    slug TEXT,
    excerpt TEXT,
    content_html TEXT,
    PRIMARY KEY (post_id, language)
  );`,

  `CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    is_home INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS pages_translations (
    page_id INTEGER,
    language TEXT,
    title TEXT,
    slug TEXT,
    full_path TEXT,
    content_html TEXT,
    PRIMARY KEY (page_id, language)
  );`,

  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS categories_translations (
    category_id INTEGER,
    language TEXT,
    name TEXT,
    slug TEXT,
    full_path TEXT,
    PRIMARY KEY (category_id, language)
  );`,

  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  );`,

  `CREATE TABLE IF NOT EXISTS tags_translations (
    tag_id INTEGER,
    language TEXT,
    name TEXT,
    slug TEXT,
    PRIMARY KEY (tag_id, language)
  );`,

  `CREATE TABLE IF NOT EXISTS posts_tags (
    post_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (post_id, tag_id)
  );`,

  `CREATE TABLE IF NOT EXISTS posts_categories (
    post_id INTEGER,
    category_id INTEGER,
    PRIMARY KEY (post_id, category_id)
  );`,

  `CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    original_filename TEXT,
    mime TEXT,
    size_bytes INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS media_usages (
    post_id INTEGER,
    media_id INTEGER,
    field TEXT,
    position INTEGER DEFAULT 0
  );`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT,
    entity_type TEXT,
    entity_id INTEGER,
    meta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`
];

(async () => {
  console.log("[bootstrap] Using DB:", DB_FILE);
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec("BEGIN");
  try {
    for (const sql of DDL) { await db.exec(sql); }
    // defaults cho settings nếu chưa có
    await db.run("INSERT INTO settings(key,value) VALUES('max_image_size_mb','5') ON CONFLICT(key) DO NOTHING");
    await db.run("INSERT INTO settings(key,value) VALUES('disk_alert_mb','500') ON CONFLICT(key) DO NOTHING");
    await db.run("INSERT INTO settings(key,value) VALUES('ga4_measurement_id','') ON CONFLICT(key) DO NOTHING");
    await db.run("INSERT INTO settings(key,value) VALUES('gsc_meta_tag','') ON CONFLICT(key) DO NOTHING");
    await db.exec("COMMIT");
    console.log("[bootstrap] Schema ensured.");
  } catch (e) {
    await db.exec("ROLLBACK");
    console.error(e);
    process.exit(1);
  }
})();
