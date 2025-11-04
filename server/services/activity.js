// server/services/activity.js
import { getDb } from '../utils/db.js';

export async function ensureActivitySchema() {
  const db = await getDb();

  // Tạo bảng nếu chưa có
  await db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,                -- người thực hiện (có thể NULL)
      action TEXT NOT NULL,           -- create | update | trash | restore | ...
      entity_type TEXT NOT NULL,      -- 'page' | 'post' | 'category' | ...
      entity_id INTEGER NOT NULL,
      meta TEXT,                      -- JSON (tùy chọn)
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Đảm bảo cột user_id tồn tại (phòng khi bảng cũ chưa có)
  const cols = await db.all(`PRAGMA table_info(activity_logs)`);
  const hasUserId = cols.some(c => c.name === 'user_id');
  if (!hasUserId) {
    await db.run(`ALTER TABLE activity_logs ADD COLUMN user_id INTEGER`);
  }
}

export async function logActivity(userId, action, entityType, entityId, meta = null, req = null) {
  const db = await getDb();
  await ensureActivitySchema();

  const ip = (req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null);
  const ua = (req?.headers?.['user-agent'] || null);

  await db.run(
    `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, meta, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId ?? null,
      action,
      entityType,
      entityId,
      meta ? JSON.stringify(meta) : null,
      ip,
      ua
    ]
  );
}
