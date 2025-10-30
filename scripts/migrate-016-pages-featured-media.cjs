// scripts/migrate-016-pages-featured-media.cjs
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

(async () => {
  const DB_FILE = process.env.DB_FILE || "./data/app.db";
  console.log("[m016] Using DB:", DB_FILE);
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });

  async function hasColumn(table, col) {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return rows.some(r => r.name === col);
  }

  try {
    if (!(await hasColumn("pages", "featured_media_id"))) {
      await db.exec(`ALTER TABLE pages ADD COLUMN featured_media_id INTEGER`);
      console.log("[m016] Added pages.featured_media_id");
    } else {
      console.log("[m016] OK pages.featured_media_id");
    }
  } catch (e) {
    console.error("[m016] ERROR:", e.message);
    process.exit(1);
  } finally {
    await db.close();
  }
  console.log("[m016] Done.");
})();
