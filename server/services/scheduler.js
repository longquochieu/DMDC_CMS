// server/services/scheduler.js
import { getDb } from '../utils/db.js';

export async function runSchedulerTick() {
  const db = await getDb();
  // Đưa các bài đã đến giờ lên lịch → published
  await db.run(`
    UPDATE posts
    SET status='published',
        published_at = COALESCE(published_at, scheduled_at),
        updated_at = CURRENT_TIMESTAMP
    WHERE status='scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= CURRENT_TIMESTAMP
      AND deleted_at IS NULL
  `);
}
