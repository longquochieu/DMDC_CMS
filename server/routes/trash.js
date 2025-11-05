// server/routes/trash.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

// Map tab -> entity + sql
const TAB_ENTITY = {
  pages:  { entity: "page",  titleCol: "title", table: "pages",  trTable: "pages_translations",  trKey: "page_id" },
  posts:  { entity: "post",  titleCol: "title", table: "posts",  trTable: "posts_translations",  trKey: "post_id" },
  categories: { entity: "category", titleCol: "name", table: "categories", trTable: "categories_translations", trKey: "category_id" },
  tags:   { entity: "tag",   titleCol: "name", table: "tags",   trTable: "tags_translations",   trKey: "tag_id" },
  media:  { entity: "media", titleCol: "filename", table: "media" }
};

function normTab(input) {
  return TAB_ENTITY[input] ? input : "posts";
}

async function listRows(db, tab, lang) {
  const cfg = TAB_ENTITY[tab];
  if (tab === "media") {
    return db.all(`
      SELECT m.id, m.filename AS title, m.url AS slug,
             m.deleted_at,
             (SELECT u.username FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
              WHERE al.entity_type='media' AND al.entity_id=m.id AND al.action='trash'
              ORDER BY al.created_at DESC LIMIT 1) AS deleter_username,
             (SELECT al.created_at FROM activity_logs al
              WHERE al.entity_type='media' AND al.entity_id=m.id AND al.action='trash'
              ORDER BY al.created_at DESC LIMIT 1) AS deleted_time
      FROM media m
      WHERE m.deleted_at IS NOT NULL
      ORDER BY m.deleted_at DESC, m.id DESC
    `);
  }

  const { table, trTable, trKey, titleCol, entity } = cfg;
  return db.all(`
    SELECT
      b.id,
      t.${titleCol} AS title,
      t.slug AS slug,
      b.deleted_at,
      (SELECT u.username
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
        WHERE al.entity_type = ? AND al.entity_id = b.id AND al.action = 'trash'
        ORDER BY al.created_at DESC LIMIT 1) AS deleter_username,
      (SELECT al.created_at
         FROM activity_logs al
        WHERE al.entity_type = ? AND al.entity_id = b.id AND al.action = 'trash'
        ORDER BY al.created_at DESC LIMIT 1) AS deleted_time
    FROM ${table} b
    LEFT JOIN ${trTable} t ON t.${trKey} = b.id AND t.language = ?
    WHERE b.deleted_at IS NOT NULL
    ORDER BY b.deleted_at DESC, b.id DESC
  `, [entity, entity, lang]);
}

// == INDEX
router.get("/", requireAuth, async (req, res) => {
  const db   = await getDb();
  const tab  = normTab(req.query.tab);
  const lang = "vi"; // dùng default đã set
  const rows = await listRows(db, tab, lang);

  res.render("trash/index", {
    pageTitle: "Thùng rác",
    tab,
    rows,
    ok: req.query.ok || "",
    err: req.query.err || "",
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || "")
  });
});

// == EMPTY TRASH theo tab
router.post("/empty", requireRoles("admin"), async (req, res) => {
  const db  = await getDb();
  const tab = normTab(req.query.tab);
  const { entity, table } = TAB_ENTITY[tab];

  try {
    await db.exec("BEGIN IMMEDIATE");

    if (tab === "pages") {
      await db.run(`DELETE FROM pages_translations WHERE page_id IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM pages WHERE deleted_at IS NOT NULL`);
    } else if (tab === "posts") {
      await db.run(`DELETE FROM posts_translations WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM posts_categories WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM posts_tags WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM media_usages WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM posts WHERE deleted_at IS NOT NULL`);
    } else if (tab === "categories") {
      await db.run(`DELETE FROM categories_translations WHERE category_id IN (SELECT id FROM categories WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM categories WHERE deleted_at IS NOT NULL`);
    } else if (tab === "tags") {
      await db.run(`DELETE FROM tags_translations WHERE tag_id IN (SELECT id FROM tags WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM posts_tags WHERE tag_id IN (SELECT id FROM tags WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM tags WHERE deleted_at IS NOT NULL`);
    } else if (tab === "media") {
      await db.run(`DELETE FROM media_usages WHERE media_id IN (SELECT id FROM media WHERE deleted_at IS NOT NULL)`);
      await db.run(`DELETE FROM media WHERE deleted_at IS NOT NULL`);
    } else {
      throw new Error("Tab không hợp lệ");
    }

    await logActivity(req.user.id, "empty_trash", entity, 0);
    await db.exec("COMMIT");
    return res.redirect(`/admin/trash?tab=${tab}&ok=empty_done`);
  } catch (e) {
    try { await db.exec("ROLLBACK"); } catch {}
    return res.redirect(`/admin/trash?tab=${tab}&err=${encodeURIComponent(e.message)}`);
  }
});

// == BULK actions: /admin/trash/bulk?tab=posts  body: ids[], action
router.post("/bulk", requireRoles("admin"), async (req, res) => {
  const db  = await getDb();
  const tab = normTab(req.query.tab);
  const cfg = TAB_ENTITY[tab];
  const ids = (Array.isArray(req.body["ids[]"]) ? req.body["ids[]"] : (req.body.ids || [])).map(x => parseInt(x,10)).filter(Boolean);
  const action = (req.body.action || "").toLowerCase(); // restore|destroy

  if (!ids.length) return res.redirect(`/admin/trash?tab=${tab}&err=No%20selection`);
  if (!["restore","destroy"].includes(action)) return res.redirect(`/admin/trash?tab=${tab}&err=Invalid%20action`);

  try {
    await db.exec("BEGIN IMMEDIATE");

    if (action === "restore") {
      if (tab === "media") {
        await db.run(`UPDATE media SET deleted_at=NULL WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      } else {
        await db.run(`UPDATE ${cfg.table} SET deleted_at=NULL WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      }
      for (const id of ids) await logActivity(req.user.id, "restore", cfg.entity, id);
    } else {
      // destroy
      if (tab === "pages") {
        await db.run(`DELETE FROM pages_translations WHERE page_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM pages WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      } else if (tab === "posts") {
        await db.run(`DELETE FROM posts_translations WHERE post_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM posts_categories WHERE post_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM posts_tags WHERE post_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM media_usages WHERE post_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM posts WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      } else if (tab === "categories") {
        await db.run(`DELETE FROM categories_translations WHERE category_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM categories WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      } else if (tab === "tags") {
        await db.run(`DELETE FROM tags_translations WHERE tag_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM posts_tags WHERE tag_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM tags WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      } else if (tab === "media") {
        await db.run(`DELETE FROM media_usages WHERE media_id IN (${ids.map(()=>'?').join(',')})`, ids);
        await db.run(`DELETE FROM media WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
      }
      for (const id of ids) await logActivity(req.user.id, "destroy", cfg.entity, id);
    }

    await db.exec("COMMIT");
    return res.redirect(`/admin/trash?tab=${tab}&ok=${action}_done`);
  } catch (e) {
    try { await db.exec("ROLLBACK"); } catch {}
    return res.redirect(`/admin/trash?tab=${tab}&err=${encodeURIComponent(e.message)}`);
  }
});

// == Action từng dòng: restore / destroy / edit (restore rồi chuyển tới edit)
router.post("/:entity/:id/restore", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const { entity, id } = req.params;
  const tab = Object.keys(TAB_ENTITY).find(k => TAB_ENTITY[k].entity === entity) || "posts";
  const cfg = TAB_ENTITY[tab];

  await db.run(`UPDATE ${cfg.table} SET deleted_at=NULL WHERE id=?`, id);
  await logActivity(req.user.id, "restore", entity, id);
  return res.redirect(`/admin/trash?tab=${tab}&ok=restored`);
});

router.post("/:entity/:id/destroy", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const { entity, id } = req.params;
  const tab = Object.keys(TAB_ENTITY).find(k => TAB_ENTITY[k].entity === entity) || "posts";

  await router.handle({ ...req, method:"POST", url:`/bulk?tab=${tab}` }, res, () => {});
  // mẹo: dùng bulk destroy cho 1 id
});

router.post("/:entity/:id/edit", requireRoles("admin"), async (req, res) => {
  const { entity, id } = req.params;
  // tự khôi phục rồi chuyển sang /admin/{entity}s/:id/edit
  const tab = Object.keys(TAB_ENTITY).find(k => TAB_ENTITY[k].entity === entity) || "posts";
  const db = await getDb();
  const cfg = TAB_ENTITY[tab];

  await db.run(`UPDATE ${cfg.table} SET deleted_at=NULL WHERE id=?`, id);
  await logActivity(req.user.id, "restore", entity, id);

  const editPath = (entity === "page") ? `/admin/pages/${id}/edit`
                  : (entity === "post") ? `/admin/posts/${id}/edit`
                  : (entity === "category") ? `/admin/categories/${id}/edit`
                  : (entity === "tag") ? `/admin/tags/${id}/edit`
                  : (entity === "media") ? `/admin/media/${id}/edit`
                  : `/admin`;

  return res.redirect(editPath);
});

export default router;
