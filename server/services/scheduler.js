// server/services/scheduler.js
import { getDb } from "../utils/db.js";

export async function runSchedulerTick() {
  const db = await getDb();
  const rows = await db.all(
    `SELECT id FROM posts
     WHERE status='scheduled'
       AND scheduled_at IS NOT NULL
       AND datetime(scheduled_at) <= datetime('now')`
  );
  if (!rows || !rows.length) return { promoted: 0 };

  await db.run("BEGIN");
  try {
    for (const r of rows) {
      await db.run(
        `UPDATE posts
         SET status='published',
             updated_at=CURRENT_TIMESTAMP,
             published_at = COALESCE(scheduled_at, CURRENT_TIMESTAMP)
         WHERE id=?`,
        r.id
      );
    }
    await db.run("COMMIT");
    return { promoted: rows.length };
  } catch (e) {
    await db.run("ROLLBACK");
    throw e;
  }
}
