// server/routes/trash.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const tab = ["pages", "posts", "categories"].includes(req.query.tab)
    ? req.query.tab
    : "posts";

  const ok = req.query.ok || "";
  const err = req.query.err || "";

  // Pages đã xoá
  const pages = await db.all(
    `
    SELECT p.id,
           COALESCE(t.title,'(Không tên)') AS title,
           -- người xoá
           (SELECT u.username
              FROM activity_logs al
              JOIN users u ON u.id = al.user_id
             WHERE al.entity_type='page' AND al.entity_id=p.id AND al.action='trash'
             ORDER BY al.created_at DESC LIMIT 1) AS deleted_by,
           -- thời điểm xoá
           (SELECT al.created_at
              FROM activity_logs al
             WHERE al.entity_type='page' AND al.entity_id=p.id AND al.action='trash'
             ORDER BY al.created_at DESC LIMIT 1) AS deleted_at
      FROM pages p
      LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
     WHERE p.deleted_at IS NOT NULL
     ORDER BY p.deleted_at DESC
  `,
    [lang]
  );

  // Posts đã xoá
  const posts = await db.all(
    `
    SELECT p.id,
           COALESCE(t.title,'(Không tên)') AS title,
           (SELECT u.username
              FROM activity_logs al
              JOIN users u ON u.id = al.user_id
             WHERE al.entity_type='post' AND al.entity_id=p.id AND al.action='trash'
             ORDER BY al.created_at DESC LIMIT 1) AS deleted_by,
           (SELECT al.created_at
              FROM activity_logs al
             WHERE al.entity_type='post' AND al.entity_id=p.id AND al.action='trash'
             ORDER BY al.created_at DESC LIMIT 1) AS deleted_at
      FROM posts p
      LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
     WHERE p.deleted_at IS NOT NULL
     ORDER BY p.deleted_at DESC
  `,
    [lang]
  );

  // Categories đã xoá (tab mới)
  const categories = await db.all(
    `
    SELECT c.id,
           COALESCE(ct.name,'(Không tên)') AS title,
           ct.slug AS slug,
           (SELECT u.username
              FROM activity_logs al
              JOIN users u ON u.id = al.user_id
             WHERE al.entity_type='category' AND al.entity_id=c.id AND al.action='trash'
             ORDER BY al.created_at DESC LIMIT 1) AS deleted_by,
           (SELECT al.created_at
              FROM activity_logs al
             WHERE al.entity_type='category' AND al.entity_id=c.id AND al.action='trash'
             ORDER BY al.created_at DESC LIMIT 1) AS deleted_at
      FROM categories c
      LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
     WHERE c.deleted_at IS NOT NULL
     ORDER BY c.deleted_at DESC
  `,
    [lang]
  );

  res.render("trash/index", {
    pageTitle: "Thùng rác",
    tab,
    pages,
    posts,
    categories,
    ok,
    err,
    csrfToken: req.csrfToken ? req.csrfToken() : res.locals.csrfToken || "",
  });
});

/* ======= Hành động khôi phục/xoá hẳn ======= */
// PAGES
router.post("/pages/:id/restore", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  await db.run(`UPDATE pages SET deleted_at = NULL WHERE id = ?`, id);
  return res.redirect("/admin/trash?tab=pages&ok=restored");
});

router.post("/pages/:id/delete", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  await db.run(`DELETE FROM pages_translations WHERE page_id = ?`, id);
  await db.run(`DELETE FROM pages WHERE id = ?`, id);
  return res.redirect("/admin/trash?tab=pages&ok=deleted");
});

// POSTS
router.post("/posts/:id/restore", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  await db.run(`UPDATE posts SET deleted_at = NULL WHERE id = ?`, id);
  return res.redirect("/admin/trash?tab=posts&ok=restored");
});

router.post("/posts/:id/delete", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  await db.run(`DELETE FROM posts_translations WHERE post_id = ?`, id);
  await db.run(`DELETE FROM posts_categories WHERE post_id = ?`, id);
  await db.run(`DELETE FROM posts_tags WHERE post_id = ?`, id);
  await db.run(`DELETE FROM posts WHERE id = ?`, id);
  return res.redirect("/admin/trash?tab=posts&ok=deleted");
});

// CATEGORIES
router.post(
  "/categories/:id/restore",
  requireRoles("admin"),
  async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    await db.run(`UPDATE categories SET deleted_at = NULL WHERE id = ?`, id);
    return res.redirect("/admin/trash?tab=categories&ok=restored");
  }
);

router.post(
  "/categories/:id/delete",
  requireRoles("admin"),
  async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    await db.run(`DELETE FROM categories_translations WHERE category_id = ?`, id);
    await db.run(`DELETE FROM categories WHERE id = ?`, id);
    return res.redirect("/admin/trash?tab=categories&ok=deleted");
  }
);

export default router;
