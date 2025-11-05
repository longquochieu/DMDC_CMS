// server/routes/logs.js
import express from "express";
import { requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { exportActivityCsv, purgeActivityLogs, getRetentionDays } from "../services/activity.js";

const router = express.Router();

function buildWhere(q) {
  const wh = ["1=1"];
  const params = [];
  if (q.user_id) { wh.push("al.user_id = ?"); params.push(q.user_id); }
  if (q.action)  { wh.push("al.action = ?"); params.push(q.action); }
  if (q.entity_type) { wh.push("al.entity_type = ?"); params.push(q.entity_type); }
  if (q.date_from) { wh.push("al.created_at >= ?"); params.push(q.date_from + " 00:00:00"); }
  if (q.date_to)   { wh.push("al.created_at <= ?"); params.push(q.date_to   + " 23:59:59"); }
  if (q.q) { wh.push("(al.extra_json LIKE ? OR al.meta LIKE ?)"); params.push(`%${q.q}%`, `%${q.q}%`); }
  return { where: wh.join(" AND "), params };
}

router.get("/", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const { where, params } = buildWhere(req.query);
  const rows = await db.all(`
    SELECT al.*, u.username
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE ${where}
    ORDER BY al.created_at DESC
    LIMIT 1000
  `, params);

  res.render("logs/list", {
    pageTitle: "Activity Logs",
    rows,
    q: req.query,
    retention_days: await getRetentionDays(),
    ok: req.query.ok || "",
    err: req.query.err || "",
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || "")
  });
});

router.get("/export", requireRoles("admin"), async (req, res) => {
  const { where, params } = buildWhere(req.query);
  const csv = await exportActivityCsv(where, params);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=activity_logs.csv");
  res.send(csv);
});

// manual cleanup
router.post("/cleanup", requireRoles("admin"), async (req, res) => {
  const days = parseInt(req.body.retention_days || "90", 10);
  try {
    await purgeActivityLogs(days);
    return res.redirect("/admin/logs?ok=purged");
  } catch (e) {
    return res.redirect(`/admin/logs?err=${encodeURIComponent(e.message)}`);
  }
});

export default router;
