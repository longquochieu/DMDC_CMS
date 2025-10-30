const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcryptjs");

const DB_PATH = process.env.DB_PATH || process.env.DB_FILE || "./data/app.db";

// cấu hình tài khoản mặc định
const USERNAME = "admin";
const EMAIL = "admin@localhost";
const PASSWORD = "Admin@123"; // bạn sẽ dùng pass này để đăng nhập

(async () => {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  const hash = await bcrypt.hash(PASSWORD, 10);

  // nếu đã có user 'admin' -> update; nếu chưa -> insert
  await db.run(`
    INSERT INTO users (username,email,password_hash,role,status,display_name,session_version,created_at,updated_at)
    VALUES (?, ?, ?, 'admin', 'active', 'Administrator', 1, datetime('now'), datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      email=excluded.email,
      password_hash=excluded.password_hash,
      role='admin',
      status='active',
      updated_at=datetime('now')
  `, USERNAME, EMAIL, hash);

  const row = await db.get(`SELECT id, username, email, role FROM users WHERE username=?`, USERNAME);
  console.log("[upsert-admin] OK:", row);
})();
