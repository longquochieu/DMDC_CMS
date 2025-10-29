import { getDb } from '../utils/db.js';

export async function runSchedulerTick() {
  const db = await getDb();
  const now = new Date().toISOString();
  const posts = await db.all(`SELECT id FROM posts
    WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? AND deleted_at IS NULL`, now);
  for (const p of posts) {
    await db.run(`UPDATE posts SET status='published', published_at = CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id = ?`, p.id);
    await db.run(`INSERT INTO activity_logs(user_id, action, entity_type, entity_id, meta_json, created_at)
                  VALUES(NULL, 'publish', 'post', ?, json('{}'), CURRENT_TIMESTAMP)`, p.id);
  }
  return posts.length;
}
