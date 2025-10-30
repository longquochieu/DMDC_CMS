// scripts/migrate-014-structure.cjs
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const DB = process.env.DB_PATH || process.env.DB_FILE || "./data/app.db";

async function addCol(db, table, colDef) {
  try {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
    console.log(`[m014] Added ${table}.${colDef.split(' ')[0]}`);
  } catch (e) {
    if (String(e).includes('duplicate column') || String(e).includes('already exists')) {
      console.log(`[m014] OK ${table}.${colDef.split(' ')[0]}`);
    } else {
      throw e;
    }
  }
}

(async () => {
  console.log("[m014] Using DB:", DB);
  const db = await open({ filename: DB, driver: sqlite3.Database });
  await db.exec("BEGIN");
  try {
    // pages
    await addCol(db, "pages", "status TEXT DEFAULT 'draft'");
    await addCol(db, "pages", "order_index INTEGER DEFAULT 0");
    await addCol(db, "pages", "created_by INTEGER");
    await addCol(db, "pages", "updated_by INTEGER");
    await db.exec("UPDATE pages SET order_index = COALESCE(order_index, 0)");
    await db.exec("UPDATE pages SET status = COALESCE(status, 'draft')");

    // categories
    await addCol(db, "categories", "order_index INTEGER DEFAULT 0");
    await addCol(db, "categories", "created_by INTEGER");
    await addCol(db, "categories", "updated_by INTEGER");
    await db.exec("UPDATE categories SET order_index = COALESCE(order_index, 0)");

    await db.exec("COMMIT");
    console.log("[m014] Done.");
  } catch (e) {
    await db.exec("ROLLBACK");
    console.error(e);
    process.exit(1);
  }
})();
