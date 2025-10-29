
PRAGMA foreign_keys = ON;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','author','contributor')) DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'active',
  avatar TEXT,
  last_login DATETIME,
  last_activity DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PAGES
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  order_index INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  deleted_at DATETIME,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pages_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  full_path TEXT NOT NULL,
  content_html TEXT,
  seo_title TEXT, seo_description TEXT, seo_keywords TEXT,
  og_title TEXT, og_description TEXT, canonical_url TEXT, meta_robots TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(language, slug),
  UNIQUE(language, full_path)
);

-- POSTS
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('draft','pending','scheduled','published')) DEFAULT 'draft',
  display_date DATETIME,
  scheduled_at DATETIME,
  published_at DATETIME,
  deleted_at DATETIME,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content_html TEXT,
  seo_title TEXT, seo_description TEXT, seo_keywords TEXT,
  og_title TEXT, og_description TEXT, canonical_url TEXT, meta_robots TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(language, slug)
);

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  order_index INTEGER DEFAULT 0,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  full_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(language, slug),
  UNIQUE(language, full_path)
);

-- TAGS
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tags_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(language, slug)
);

-- RELATIONS
CREATE TABLE IF NOT EXISTS posts_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE TABLE IF NOT EXISTS posts_categories (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);

-- MEDIA
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  url TEXT NOT NULL,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field TEXT
);

-- SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  meta_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FTS5
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(title, content, language, content='pages_translations', content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(title, content, language, content='posts_translations', content_rowid='id');

-- FTS triggers for pages_translations
CREATE TRIGGER IF NOT EXISTS pages_translations_ai AFTER INSERT ON pages_translations BEGIN
  INSERT INTO pages_fts(rowid, title, content, language) VALUES (new.id, new.title, new.content_html, new.language);
END;
CREATE TRIGGER IF NOT EXISTS pages_translations_au AFTER UPDATE ON pages_translations BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content, language) VALUES('delete', old.id, old.title, old.content_html, old.language);
  INSERT INTO pages_fts(rowid, title, content, language) VALUES (new.id, new.title, new.content_html, new.language);
END;
CREATE TRIGGER IF NOT EXISTS pages_translations_ad AFTER DELETE ON pages_translations BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content, language) VALUES('delete', old.id, old.title, old.content_html, old.language);
END;

-- FTS triggers for posts_translations
CREATE TRIGGER IF NOT EXISTS posts_translations_ai AFTER INSERT ON posts_translations BEGIN
  INSERT INTO posts_fts(rowid, title, content, language) VALUES (new.id, new.title, new.content_html, new.language);
END;
CREATE TRIGGER IF NOT EXISTS posts_translations_au AFTER UPDATE ON posts_translations BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content, language) VALUES('delete', old.id, old.title, old.content_html, old.language);
  INSERT INTO posts_fts(rowid, title, content, language) VALUES (new.id, new.title, new.content_html, new.language);
END;
CREATE TRIGGER IF NOT EXISTS posts_translations_ad AFTER DELETE ON posts_translations BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content, language) VALUES('delete', old.id, old.title, old.content_html, old.language);
END;

-- DEFAULT SETTINGS
INSERT OR IGNORE INTO settings(key, value) VALUES
('default_language','vi'),
('i18n_url_mode','path'),
('timezone','Asia/Ho_Chi_Minh'),
('date_format','d/m/Y'),
('time_format','H:i');
