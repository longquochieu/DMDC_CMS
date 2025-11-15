// scripts/migrate-users-profile.js
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// DÙNG tiện ích DB sẵn có của dự án
import { getDb } from "../server/utils/db.js";

async function ensureColumn(db, table, col, type) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  const exists = rows.some(r => r.name === col);
  if (!exists) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    console.log(`Added ${table}.${col}`);
  }
}

async function main() {
  const db = await getDb();

  // Hồ sơ / tuỳ chọn
  await ensureColumn(db, "users", "display_name", "TEXT");
  await ensureColumn(db, "users", "avatar_url", "TEXT");
  await ensureColumn(db, "users", "phone", "TEXT");
  await ensureColumn(db, "users", "bio", "TEXT");

  await ensureColumn(db, "users", "locale", "TEXT");
  await ensureColumn(db, "users", "timezone", "TEXT");
  await ensureColumn(db, "users", "date_format", "TEXT");
  await ensureColumn(db, "users", "time_format", "TEXT");
  await ensureColumn(db, "users", "items_per_page", "INTEGER");
  await ensureColumn(db, "users", "editor_mode", "TEXT");
  await ensureColumn(db, "users", "theme", "TEXT");
  await ensureColumn(db, "users", "sidebar_collapsed", "INTEGER"); // 0/1

  await ensureColumn(db, "users", "notify_inapp", "INTEGER"); // 0/1
  await ensureColumn(db, "users", "notify_email", "INTEGER"); // 0/1

  await ensureColumn(db, "users", "last_login", "TEXT");    // UTC string
  await ensureColumn(db, "users", "last_activity", "TEXT"); // UTC string
  await ensureColumn(db, "users", "status", "TEXT");        // 'active' | 'inactive'

  // Tuỳ chọn 2FA (để dành V2, thêm không hại)
  await ensureColumn(db, "users", "two_factor_enabled", "INTEGER"); // 0/1
  await ensureColumn(db, "users", "two_factor_secret", "TEXT");

  console.log("OK: users table migrated.");
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
