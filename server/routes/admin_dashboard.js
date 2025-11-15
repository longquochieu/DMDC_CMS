// server/routes/admin_dashboard.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import fs from "fs";
import path from "path";

const router = express.Router();

// helper: tính dung lượng thư mục uploads (MB)
async function getFolderSizeMB(dir) {
  return new Promise((resolve) => {
    let total = 0;
    const walk = (p) => {
      if (!fs.existsSync(p)) return;
      const items = fs.readdirSync(p, { withFileTypes: true });
      for (const it of items) {
        const full = path.join(p, it.name);
        try {
          const st = fs.statSync(full);
          if (it.isDirectory()) walk(full);
          else total += st.size;
        } catch { /* ignore */ }
      }
    };
    try { walk(dir); } catch { /* ignore */ }
    resolve(Number((total / (1024 * 1024)).toFixed(2)));
  });
}

router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();

  // Đếm cơ bản
  const posts = (await db.get(`SELECT COUNT(*) AS cnt FROM posts WHERE deleted_at IS NULL`))?.cnt ?? 0;
  const pages = (await db.get(`SELECT COUNT(*) AS cnt FROM pages WHERE deleted_at IS NULL`))?.cnt ?? 0;
  const media = (await db.get(`SELECT COUNT(*) AS cnt FROM media WHERE deleted_at IS NULL`))?.cnt ?? 0;
  const users = (await db.get(`SELECT COUNT(*) AS cnt FROM users WHERE deleted_at IS NULL`))?.cnt ?? 0;

  const stats = { posts, pages, media, users };

  // Bài viết đã lên lịch (10 sắp tới)
  const scheduled = await db.all(`
    SELECT p.id,
           COALESCE(t.title, '(Không tiêu đề)') AS title,
           p.status,
           p.scheduled_at
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id = p.id
    WHERE p.deleted_at IS NULL AND p.status = 'scheduled' AND p.scheduled_at IS NOT NULL
    ORDER BY p.scheduled_at ASC
    LIMIT 10
  `) || [];

  // Bài viết gần đây (10 mới cập nhật)
  const recent = await db.all(`
    SELECT p.id,
           COALESCE(t.title, '(Không tiêu đề)') AS title,
           p.status,
           p.updated_at
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id = p.id
    WHERE p.deleted_at IS NULL
    ORDER BY p.updated_at DESC
    LIMIT 10
  `) || [];

  // Activity logs (10 dòng gần nhất)
  // Yêu cầu bảng activity_logs có các cột: created_at, action, entity_type, entity_id, actor_id
  let logs = [];
  try {
    logs = await db.all(`
      SELECT created_at, action, entity_type, entity_id, actor_id
      FROM activity_logs
      ORDER BY created_at DESC
      LIMIT 10
    `) || [];
  } catch {
    logs = [];
  }

  // System info
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const uploads_mb = await getFolderSizeMB(uploadDir);

  // DB size (MySQL). Nếu vẫn dùng SQLite thì gán 0.
  let db_mb = 0;
  try {
    // MySQL: kích thước DB hiện tại
    const row = await db.get(`
      SELECT ROUND(SUM(data_length + index_length)/1024/1024, 2) AS mb
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `);
    db_mb = row?.mb ?? 0;
  } catch {
    db_mb = 0;
  }

  const sys = {
    uploads_mb,
    db_mb,
    alert: uploads_mb > 500 // ví dụ cảnh báo nếu uploads > 500MB
  };

  // Settings (để hiển thị GA4 trong view)
  let settings = { ga4_measurement_id: "" };
  try {
    const s = await db.get(`SELECT value FROM settings WHERE key = 'ga4_measurement_id'`);
    settings.ga4_measurement_id = s?.value || "";
  } catch {
    // bỏ qua nếu chưa có bảng/cột
  }

  res.render("dashboard", {
    pageTitle: "Tổng quan",
    stats,        // ← view của bạn dùng
    scheduled,    // ← view của bạn dùng
    recent,       // ← view của bạn dùng
    logs,         // ← view của bạn dùng
    sys,          // ← view của bạn dùng
    settings,     // ← view của bạn dùng
  });
});

export default router;
