-- scripts/mysql-schema.sql
-- Chạy: mysql -h127.0.0.1 -u dmdc -p dmdc_cms < scripts/mysql-schema.sql

-- ========== SETTINGS ==========
CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(191) PRIMARY KEY,
  `value` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== USERS ==========
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(100) NOT NULL UNIQUE,
  email          VARCHAR(191) NULL,
  password_hash  VARCHAR(191) NOT NULL,
  role           ENUM('admin','editor','author','contributor') NOT NULL DEFAULT 'admin',
  display_name   VARCHAR(191) NULL,
  avatar_path    VARCHAR(255) NULL,
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  last_activity  DATETIME NULL,
  session_version INT NOT NULL DEFAULT 1,
  deleted_at     DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO users (id, username, email, password_hash, role, display_name, status)
VALUES (1, 'admin', 'admin@example.com', '$2a$10$7h9eQ0J9QK1iR9O7GJ7u7O2o3zjK5kYQ1tQK8v1lM3Z1iX9u2wFf6', 'admin', 'Administrator', 'active');
-- Lưu ý: password_hash ở trên là ví dụ, bạn có thể cập nhật lại bằng script fix-admin-login như cũ

-- ========== PAGES ==========
CREATE TABLE IF NOT EXISTS pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  status       ENUM('draft','published','scheduled') NOT NULL DEFAULT 'draft',
  created_by   INT NULL,
  updated_by   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  scheduled_at DATETIME NULL,
  deleted_at   DATETIME NULL,
  -- các cột bổ sung bạn báo thiếu
  template          VARCHAR(191) NULL,
  featured_media_id INT NULL,
  CONSTRAINT fk_pages_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pages_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pages_translations (
  page_id   INT NOT NULL,
  language  VARCHAR(10) NOT NULL,
  title     VARCHAR(255) NULL,
  slug      VARCHAR(255) NULL,
  content_html MEDIUMTEXT NULL,
  PRIMARY KEY (page_id, language),
  KEY idx_pages_translations_slug (slug),
  CONSTRAINT fk_pt_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== POSTS ==========
CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  status       ENUM('draft','published','scheduled') NOT NULL DEFAULT 'draft',
  created_by   INT NULL,
  updated_by   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  scheduled_at DATETIME NULL,
  deleted_at   DATETIME NULL,
  CONSTRAINT fk_posts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts_translations (
  post_id   INT NOT NULL,
  language  VARCHAR(10) NOT NULL,
  title     VARCHAR(255) NULL,
  slug      VARCHAR(255) NULL,
  content_html MEDIUMTEXT NULL,
  PRIMARY KEY (post_id, language),
  KEY idx_posts_translations_slug (slug),
  CONSTRAINT fk_pt_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== CATEGORIES / TAGS ==========
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  parent_id INT NULL,
  order_index INT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories_translations (
  category_id INT NOT NULL,
  language    VARCHAR(10) NOT NULL,
  name        VARCHAR(255) NULL,
  slug        VARCHAR(255) NULL,
  content_html MEDIUMTEXT NULL, -- bạn đã thêm content cho category
  PRIMARY KEY (category_id, language),
  KEY idx_cat_trans_slug (slug),
  CONSTRAINT fk_ct_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts_categories (
  post_id INT NOT NULL,
  category_id INT NOT NULL,
  is_primary TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, category_id),
  CONSTRAINT fk_pc_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tags_translations (
  tag_id INT NOT NULL,
  language VARCHAR(10) NOT NULL,
  name VARCHAR(255) NULL,
  slug VARCHAR(255) NULL,
  PRIMARY KEY (tag_id, language),
  KEY idx_tag_trans_slug (slug),
  CONSTRAINT fk_tt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts_tags (
  post_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  CONSTRAINT fk_ptt_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ptt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== MEDIA ==========
CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  url          VARCHAR(500) NOT NULL,
  filename     VARCHAR(255) NULL,
  mime_type    VARCHAR(100) NULL,
  width        INT NULL,
  height       INT NULL,
  size_bytes   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS media_usages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id   INT NULL,
  page_id   INT NULL,
  media_id  INT NOT NULL,
  field     VARCHAR(50) NOT NULL, -- 'featured' | 'gallery' | ...
  position  INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_mu_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
  CONSTRAINT fk_mu_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_mu_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Folders
CREATE TABLE IF NOT EXISTS media_folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  parent_id INT NULL,
  name VARCHAR(255) NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mf_parent FOREIGN KEY (parent_id) REFERENCES media_folders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS media_folder_items (
  folder_id INT NOT NULL,
  media_id  INT NOT NULL,
  PRIMARY KEY (folder_id, media_id),
  CONSTRAINT fk_mfi_folder FOREIGN KEY (folder_id) REFERENCES media_folders(id) ON DELETE CASCADE,
  CONSTRAINT fk_mfi_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== SEO ==========
CREATE TABLE IF NOT EXISTS seo_meta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity      ENUM('post','page','category','tag') NOT NULL,
  entity_id   INT NOT NULL,
  language    VARCHAR(10) NOT NULL,
  seo_title       VARCHAR(255) NULL,
  seo_description TEXT NULL,
  focus_keyword   VARCHAR(255) NULL,
  robots_index    VARCHAR(20) NULL,    -- index/noindex
  robots_follow   VARCHAR(20) NULL,    -- follow/nofollow
  robots_advanced VARCHAR(255) NULL,
  canonical_url   VARCHAR(500) NULL,
  schema_type     VARCHAR(100) NULL,
  schema_jsonld   MEDIUMTEXT NULL,
  og_title            VARCHAR(255) NULL,
  og_description      TEXT NULL,
  og_image_url        VARCHAR(500) NULL,
  twitter_title       VARCHAR(255) NULL,
  twitter_description TEXT NULL,
  twitter_image_url   VARCHAR(500) NULL,
  UNIQUE KEY uniq_seo (entity, entity_id, language)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ACTIVITY LOGS ==========
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NULL,
  action    VARCHAR(100) NOT NULL,      -- create/update/delete/trash/restore/...
  entity    VARCHAR(100) NULL,          -- post/page/category/tag/user/media_folder/...
  entity_id INT NULL,
  ip        VARCHAR(64) NULL,
  user_agent TEXT NULL,
  extra_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
