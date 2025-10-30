// scripts/migrate-015-pages-template.cjs
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
require("dotenv").config();

(async () => {
  const DB_PATH = process.env.DB_PATH || process.env.DB_FILE || "./data/app.db";
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  console.log("[m015] Using DB:", DB_PATH);

  const cols = await db.all("PRAGMA table_info(pages)");
  const hasTemplate = cols.some(c => c.name === "template");

  if (!hasTemplate) {
    await db.exec("ALTER TABLE pages ADD COLUMN template TEXT");
    console.log("[m015] Added pages.template");
  } else {
    console.log("[m015] OK pages.template");
  }

  await db.close();
  console.log("[m015] Done.");
})();
