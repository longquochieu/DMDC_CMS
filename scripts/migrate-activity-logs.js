// scripts/migrate-activity-logs.js (ESM)
import { getDb } from "../server/utils/db.js";

async function ensureColumn(db, table, colDef) {
  const [colName] = colDef.split(/\s+/, 1);
  const info = await db.all(`PRAGMA table_info(${table});`);
  const exists = info.some(c => c.name === colName);
  if (!exists) {
    console.log(`-> Adding column ${table}.${colName}`);
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
  } else {
    console.log(`✓ Column ${table}.${colName} already exists`);
  }
}

async function main() {
  const db = await getDb();
  try {
    console.log("=== Migrating activity_logs columns ===");
    await ensureColumn(db, "activity_logs", "ip TEXT");
    await ensureColumn(db, "activity_logs", "user_agent TEXT");
    await ensureColumn(db, "activity_logs", "extra_json TEXT");

    console.log("=== Creating index (if missing) ===");
    await db.run(
      "CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id);"
    );

    console.log("Done.");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
