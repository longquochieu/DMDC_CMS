// server/services/activity.js
import { getDb } from "../utils/db.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * Ghi log hoạt động
 * @param {number|null} actorId   id user (có thể null nếu chưa đăng nhập)
 * @param {string} action         'login'|'create'|'update'|'trash'|'restore'|'destroy'|...
 * @param {string} entity         'post'|'page'|'category'|'tag'|'media'|'user'|...
 * @param {number} entityId       id của entity
 * @param {object|null} meta      object -> lưu JSON vào meta_json
 * @param {object|null} req       request (để lấy IP & User-Agent nếu cần)
 */
export async function logActivity(
  actorId,
  action,
  entity,
  entityId,
  meta = null,
  req = null
) {
  try {
    const db = await getDb();
    const ip = req?.ip || null;
    const ua =
      (req?.headers?.["user-agent"] ? String(req.headers["user-agent"]) : "")
        .slice(0, 1024) || null;
    const metaJson = meta ? JSON.stringify(meta) : null;

    // Lược đồ chuẩn: activity_logs(user_id, action, entity, entity_id, meta_json, ip, user_agent, created_at)
    await db.run(
      `INSERT INTO activity_logs
         (user_id, action, entity, entity_id, meta_json, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        actorId ?? null,
        String(action || ""),
        String(entity || ""),
        entityId ?? null,
        metaJson,
        ip,
        ua,
      ]
    );
  } catch {
    // Không để lỗi log làm hỏng luồng chính
  }
}

/** Cập nhật "last_activity" cho user (gọi trong middleware nếu muốn) */
export async function touchActivity(userId) {
  if (!userId) return;
  const db = await getDb();
  await db.run(
    `UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?`,
    [userId]
  );
}

/** Lấy số ngày lưu log (mặc định 90 ngày) — key: activity.retention.days */
export async function getRetentionDays() {
  const raw = await getSetting("activity.retention.days", "90");
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

/** Đặt số ngày lưu log */
export async function setRetentionDays(days) {
  const n = parseInt(String(days), 10);
  const keep = Number.isFinite(n) && n > 0 ? n : 90;
  await setSetting("activity.retention.days", String(keep));
  return getRetentionDays();
}

/**
 * Dọn log cũ hơn X ngày (mặc định lấy từ getRetentionDays)
 * @returns {number} affectedRows
 */
export async function purgeActivityLogs(days = null) {
  const db = await getDb();
  const keep = days ?? (await getRetentionDays());
  const n = Number.isFinite(Number(keep)) ? Math.max(1, parseInt(keep, 10)) : 90;

  // Lưu ý: dùng nội suy số nguyên an toàn cho INTERVAL để tránh lỗi bind
  const sql = `
    DELETE FROM activity_logs
    WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${n} DAY)
  `;
  const r = await db.run(sql, []);
  return r?.affectedRows ?? r?.changes ?? 0;
}

/**
 * Xuất CSV log hoạt động theo bộ lọc
 * opts: { from, to, action, entity, limit }
 * - from/to: 'YYYY-MM-DD' hoặc 'YYYY-MM-DD HH:MM:SS'
 */
export async function exportActivityCsv(opts = {}) {
  const db = await getDb();
  const {
    from = null,
    to = null,
    action = null,
    entity = null,
    limit = 10000,
  } = opts;

  const where = [];
  const params = [];

  if (entity) {
    where.push(`al.entity = ?`);
    params.push(entity);
  }
  if (action) {
    where.push(`al.action = ?`);
    params.push(action);
  }
  if (from) {
    where.push(`al.created_at >= ?`);
    params.push(from);
  }
  if (to) {
    where.push(`al.created_at <= ?`);
    params.push(to);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Alias user_id -> actor_id để tương thích với view/CSV cũ
  const sql = `
    SELECT
      al.id,
      al.created_at,
      al.action,
      al.entity,
      al.entity_id,
      al.user_id AS actor_id,
      u.username,
      al.ip,
      al.user_agent,
      al.meta_json
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${whereSql}
    ORDER BY al.id DESC
    LIMIT ?
  `;
  params.push(Number(limit) || 10000);

  const rows = await db.all(sql, params);

  // simple CSV
  const header = [
    "id",
    "created_at",
    "action",
    "entity",
    "entity_id",
    "actor_id",
    "username",
    "ip",
    "user_agent",
    "meta_json",
  ];

  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    const needs = /[",\n]/.test(s);
    const out = s.replace(/"/g, '""');
    return needs ? `"${out}"` : out;
    };

  const lines = [header.join(",")];
  for (const r of rows || []) {
    lines.push(
      [
        esc(r.id),
        esc(r.created_at),
        esc(r.action),
        esc(r.entity),
        esc(r.entity_id),
        esc(r.actor_id),
        esc(r.username),
        esc(r.ip),
        esc(r.user_agent),
        esc(r.meta_json),
      ].join(",")
    );
  }

  return {
    filename: `activity_${new Date().toISOString().slice(0, 10)}.csv`,
    mime: "text/csv; charset=utf-8",
    content: lines.join("\n"),
  };
}
