// server/services/scheduler.js
import { getDb } from "../utils/db.js";

export async function runSchedulerTick() {
  const db = await getDb();
  // Chuyển mọi bài viết "scheduled" đã đến giờ (UTC) sang "published"
  await db.run(`
    UPDATE posts
       SET status = 'published',
           updated_at = CURRENT_TIMESTAMP
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= CURRENT_TIMESTAMP
       AND deleted_at IS NULL
  `);
}
