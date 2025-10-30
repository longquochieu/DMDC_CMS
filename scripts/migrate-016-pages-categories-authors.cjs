const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const DB = process.env.DB_PATH || process.env.DB_FILE || "./data/app.db";

async function ensureColumn(db, table, col, ddl) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => (c.name||"").toLowerCase() === col.toLowerCase())) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[migrate-016] Added ${table}.${col}`);
  } else {
    console.log(`[migrate-016] OK ${table}.${col}`);
  }
}

(async () => {
  console.log("[migrate-016] Using DB:", DB);
  const db = await open({ filename: DB, driver: sqlite3.Database });
  await ensureColumn(db, "pages", "created_by", "created_by INTEGER");
  await ensureColumn(db, "pages", "updated_by", "updated_by INTEGER");
  await ensureColumn(db, "categories", "created_by", "created_by INTEGER");
  await ensureColumn(db, "categories", "updated_by", "updated_by INTEGER");
  console.log("[migrate-016] Done.");
})();
