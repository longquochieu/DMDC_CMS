const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const DB_FILE = process.env.DB_FILE || "./data/app.db";

const TABLES = [
  "users",
  "posts",
  "pages",
  "media",
  "categories",
  // dịch thuật / liên kết: có nơi code dùng điều kiện deleted_at đồng nhất -> thêm để an toàn
  "posts_translations",
  "pages_translations",
  "categories_translations",
  "tags",
  "tags_translations",
  // thường không cần, nhưng thêm sẽ không hại gì nếu code về sau có điều kiện đồng nhất
  "posts_tags",
  "posts_categories",
  "media_usages"
];

async function hasColumn(db, table, col){
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.some(r => (r.name||"").toLowerCase() === col.toLowerCase());
}

(async () => {
  console.log("[migrate-013] Using DB:", DB_FILE);
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  for (const t of TABLES) {
    try {
      const has = await hasColumn(db, t, "deleted_at");
      if (!has) {
        await db.run(`ALTER TABLE ${t} ADD COLUMN deleted_at TEXT`);
        console.log(`[migrate-013] Added ${t}.deleted_at`);
      } else {
        console.log(`[migrate-013] OK ${t}.deleted_at`);
      }
    } catch (e) {
      // nếu bảng không tồn tại hoặc ALTER không hợp lệ, log cảnh báo nhưng không dừng
      console.warn(`[migrate-013] WARN on ${t}:`, e.message);
    }
  }
  console.log("[migrate-013] Done.");
})();
