const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const DB = process.env.DB_PATH || process.env.DB_FILE || "./data/app.db";

async function ensureColumn(db, table, col, ddl) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => (c.name||"").toLowerCase() === col.toLowerCase())) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[migrate-015] Added ${table}.${col}`);
  } else {
    console.log(`[migrate-015] OK ${table}.${col}`);
  }
}

(async () => {
  console.log("[migrate-015] Using DB:", DB);
  const db = await open({ filename: DB, driver: sqlite3.Database });
  await ensureColumn(db, "pages", "order_index", "order_index INTEGER DEFAULT 0");
  await ensureColumn(db, "categories", "order_index", "order_index INTEGER DEFAULT 0");
  await ensureColumn(db, "pages", "status", "status TEXT DEFAULT 'draft'");
  console.log("[migrate-015] Done.");
})();
