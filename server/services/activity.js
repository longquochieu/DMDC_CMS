// server/services/activity.js
import { getDb } from '../utils/db.js';
// server/services/activity.js (chèn thêm các hàm dưới vào cuối file)
import { getSetting, setSetting } from "./settings.js";

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

// Giữ retention_days trong settings (mặc định 90)
export async function getRetentionDays() {
  return parseInt((await getSetting("activity_logs.retention_days", "90")) || "90", 10);
}
export async function setRetentionDays(days) {
  await setSetting("activity_logs.retention_days", String(days));
}

export async function purgeActivityLogs(days) {
  const db = await getDb();
  const n = parseInt(days || await getRetentionDays(), 10);
  await db.run(`DELETE FROM activity_logs WHERE created_at < datetime('now', ?)`, [`-${n} days`]);
  return true;
}

export async function exportActivityCsv(where, params) {
  const db = await getDb();
  const rows = await db.all(`
    SELECT al.id, al.created_at, al.user_id, u.username, al.action,
           al.entity_type, al.entity_id, al.ip, al.user_agent, al.extra_json
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE ${where}
    ORDER BY al.created_at DESC
  `, params);

  const header = [
    "id","created_at","user_id","username","action","entity_type","entity_id","ip","user_agent","extra_json"
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const esc = v => `"${String(v??"").replace(/"/g,'""')}"`;
    lines.push([
      r.id, r.created_at, r.user_id, r.username, r.action,
      r.entity_type, r.entity_id, r.ip||"", r.user_agent||"", r.extra_json||""
    ].map(esc).join(","));
  }
  return lines.join("\r\n");
}
