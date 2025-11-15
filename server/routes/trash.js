// server/routes/trash.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

// Cấu hình từng tab
const TAB_ENTITY = {
  pages: {
    entity: "page",
    titleCol: "title",
    table: "pages",
    trTable: "pages_translations",
    trKey: "page_id",
  },
  posts: {
    entity: "post",
    titleCol: "title",
    table: "posts",
    trTable: "posts_translations",
    trKey: "post_id",
  },
  categories: {
    entity: "category",
    titleCol: "name",
    table: "categories",
    trTable: "categories_translations",
    trKey: "category_id",
  },
  tags: {
    entity: "tag",
    titleCol: "name",
    table: "tags",
    trTable: "tags_translations",
    trKey: "tag_id",
  },
  media: {
    entity: "media",
    table: "media",
  },
};

function normTab(input) {
  return TAB_ENTITY[input] ? input : "posts";
}

/** Lấy danh sách theo tab (MySQL) */
async function listRows(db, tab, lang) {
  const cfg = TAB_ENTITY[tab];

  if (tab === "media") {
    // Lấy tên file từ URL để tránh lệ thuộc cột filename/original_name
    return db.all(
      `
      SELECT
        m.id,
        SUBSTRING_INDEX(m.url,'/',-1) AS name,
        m.url,
        /* người xoá cuối cùng */
        (
          SELECT u.username
          FROM activity_logs al
          LEFT JOIN users u ON u.id = al.user_id
          WHERE al.entity = 'media'
            AND al.action = 'trash'
            AND al.entity_id = m.id
          ORDER BY al.created_at DESC
          LIMIT 1
        ) AS deleter_username,
        /* thời điểm xoá */
        (
          SELECT al.created_at
          FROM activity_logs al
          WHERE al.entity = 'media'
            AND al.action = 'trash'
            AND al.entity_id = m.id
          ORDER BY al.created_at DESC
          LIMIT 1
        ) AS deleted_time,
        m.deleted_at
      FROM media m
      WHERE m.deleted_at IS NOT NULL
      ORDER BY m.deleted_at DESC
      LIMIT 500
      `
    );
  }

  // Các tab có bảng translations
  const { table, trTable, trKey, titleCol, entity } = cfg;

  return db.all(
    `
    SELECT
      b.id,
      t.${titleCol} AS title,
      t.slug AS slug,
      b.deleted_at,
      /* người xoá cuối cùng */
      (
        SELECT u.username
        FROM activity_logs al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.entity = ?
          AND al.entity_id = b.id
          AND al.action = 'trash'
        ORDER BY al.created_at DESC
        LIMIT 1
      ) AS deleter_username,
      /* thời điểm xoá */
      (
        SELECT al.created_at
        FROM activity_logs al
        WHERE al.entity = ?
          AND al.entity_id = b.id
          AND al.action = 'trash'
        ORDER BY al.created_at DESC
        LIMIT 1
      ) AS deleted_time
    FROM ${table} b
    LEFT JOIN ${trTable} t
      ON t.${trKey} = b.id AND t.language = ?
    WHERE b.deleted_at IS NOT NULL
    ORDER BY b.deleted_at DESC, b.id DESC
    `,
    [entity, entity, lang]
  );
}

/* ===================== INDEX ===================== */
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const tab = normTab(req.query.tab);
  const lang = "vi";
  const rows = await listRows(db, tab, lang);

  res.render("trash/index", {
    pageTitle: "Thùng rác",
    tab,
    rows,
    ok: req.query.ok || "",
    err: req.query.err || "",
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || ""),
  });
});

/* ===================== EMPTY TRASH ===================== */
router.post("/empty", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const tab = normTab(req.query.tab);
  const { entity } = TAB_ENTITY[tab];

  try {
    await db.exec("START TRANSACTION");

    if (tab === "pages") {
      await db.run(
        `DELETE FROM pages_translations WHERE page_id IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL)`
      );
      await db.run(`DELETE FROM pages WHERE deleted_at IS NOT NULL`);
    } else if (tab === "posts") {
      await db.run(
        `DELETE FROM posts_translations WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`
      );
      await db.run(
        `DELETE FROM posts_categories WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`
      );
      await db.run(
        `DELETE FROM posts_tags WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`
      );
      await db.run(
        `DELETE FROM media_usages WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NOT NULL)`
      );
      await db.run(`DELETE FROM posts WHERE deleted_at IS NOT NULL`);
    } else if (tab === "categories") {
      await db.run(
        `DELETE FROM categories_translations WHERE category_id IN (SELECT id FROM categories WHERE deleted_at IS NOT NULL)`
      );
      await db.run(`DELETE FROM categories WHERE deleted_at IS NOT NULL`);
    } else if (tab === "tags") {
      await db.run(
        `DELETE FROM tags_translations WHERE tag_id IN (SELECT id FROM tags WHERE deleted_at IS NOT NULL)`
      );
      await db.run(
        `DELETE FROM posts_tags WHERE tag_id IN (SELECT id FROM tags WHERE deleted_at IS NOT NULL)`
      );
      await db.run(`DELETE FROM tags WHERE deleted_at IS NOT NULL`);
    } else if (tab === "media") {
      await db.run(
        `DELETE FROM media_usages WHERE media_id IN (SELECT id FROM media WHERE deleted_at IS NOT NULL)`
      );
      await db.run(`DELETE FROM media WHERE deleted_at IS NOT NULL`);
    } else {
      throw new Error("Tab không hợp lệ");
    }

    await logActivity(req.user.id, "empty_trash", entity, 0);
    await db.exec("COMMIT");
    return res.redirect(`/admin/trash?tab=${tab}&ok=empty_done`);
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    return res.redirect(
      `/admin/trash?tab=${tab}&err=${encodeURIComponent(e.message)}`
    );
  }
});

/* ===================== BULK (restore|destroy) ===================== */
router.post("/bulk", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const tab = normTab(req.query.tab);
  const cfg = TAB_ENTITY[tab];

  const idsRaw = Array.isArray(req.body["ids[]"])
    ? req.body["ids[]"]
    : (req.body.ids || []);
  const ids = idsRaw.map((x) => parseInt(x, 10)).filter(Boolean);
  const action = (req.body.action || "").toLowerCase(); // restore|destroy

  if (!ids.length)
    return res.redirect(`/admin/trash?tab=${tab}&err=No%20selection`);
  if (!["restore", "destroy"].includes(action))
    return res.redirect(`/admin/trash?tab=${tab}&err=Invalid%20action`);

  try {
    await db.exec("START TRANSACTION");

    if (action === "restore") {
      if (tab === "media") {
        await db.run(
          `UPDATE media SET deleted_at = NULL WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else {
        await db.run(
          `UPDATE ${cfg.table} SET deleted_at = NULL WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      }
      for (const id of ids) {
        await logActivity(req.user.id, "restore", cfg.entity, id);
      }
    } else {
      // destroy
      if (tab === "pages") {
        await db.run(
          `DELETE FROM pages_translations WHERE page_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM pages WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else if (tab === "posts") {
        await db.run(
          `DELETE FROM posts_translations WHERE post_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM posts_categories WHERE post_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM posts_tags WHERE post_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM media_usages WHERE post_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM posts WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else if (tab === "categories") {
        await db.run(
          `DELETE FROM categories_translations WHERE category_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM categories WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else if (tab === "tags") {
        await db.run(
          `DELETE FROM tags_translations WHERE tag_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM posts_tags WHERE tag_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM tags WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else if (tab === "media") {
        await db.run(
          `DELETE FROM media_usages WHERE media_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await db.run(
          `DELETE FROM media WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      }
      for (const id of ids) {
        await logActivity(req.user.id, "destroy", cfg.entity, id);
      }
    }

    await db.exec("COMMIT");
    return res.redirect(`/admin/trash?tab=${tab}&ok=${action}_done`);
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    return res.redirect(
      `/admin/trash?tab=${tab}&err=${encodeURIComponent(e.message)}`
    );
  }
});

/* ===================== RESTORE 1 ITEM ===================== */
router.post("/:entity/:id/restore", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const { entity, id } = req.params;
  const tab =
    Object.keys(TAB_ENTITY).find((k) => TAB_ENTITY[k].entity === entity) ||
    "posts";
  const cfg = TAB_ENTITY[tab];

  await db.run(`UPDATE ${cfg.table} SET deleted_at = NULL WHERE id = ?`, [id]);
  await logActivity(req.user.id, "restore", entity, id);
  return res.redirect(`/admin/trash?tab=${tab}&ok=restored`);
});

/* ===================== DESTROY 1 ITEM ===================== */
router.post("/:entity/:id/destroy", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const { entity, id: idStr } = req.params;
  const id = parseInt(idStr, 10);
  const tab =
    Object.keys(TAB_ENTITY).find((k) => TAB_ENTITY[k].entity === entity) ||
    "posts";

  try {
    await db.exec("START TRANSACTION");

    if (tab === "pages") {
      await db.run(`DELETE FROM pages_translations WHERE page_id = ?`, [id]);
      await db.run(`DELETE FROM pages WHERE id = ?`, [id]);
    } else if (tab === "posts") {
      await db.run(`DELETE FROM posts_translations WHERE post_id = ?`, [id]);
      await db.run(`DELETE FROM posts_categories WHERE post_id = ?`, [id]);
      await db.run(`DELETE FROM posts_tags WHERE post_id = ?`, [id]);
      await db.run(`DELETE FROM media_usages WHERE post_id = ?`, [id]);
      await db.run(`DELETE FROM posts WHERE id = ?`, [id]);
    } else if (tab === "categories") {
      await db.run(`DELETE FROM categories_translations WHERE category_id = ?`, [id]);
      await db.run(`DELETE FROM categories WHERE id = ?`, [id]);
    } else if (tab === "tags") {
      await db.run(`DELETE FROM tags_translations WHERE tag_id = ?`, [id]);
      await db.run(`DELETE FROM posts_tags WHERE tag_id = ?`, [id]);
      await db.run(`DELETE FROM tags WHERE id = ?`, [id]);
    } else if (tab === "media") {
      await db.run(`DELETE FROM media_usages WHERE media_id = ?`, [id]);
      await db.run(`DELETE FROM media WHERE id = ?`, [id]);
    } else {
      throw new Error("Tab không hợp lệ");
    }

    await logActivity(req.user.id, "destroy", entity, id);
    await db.exec("COMMIT");
    return res.redirect(`/admin/trash?tab=${tab}&ok=destroy_done`);
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    return res.redirect(
      `/admin/trash?tab=${tab}&err=${encodeURIComponent(e.message)}`
    );
  }
});

/* ===================== RESTORE & EDIT ===================== */
router.post("/:entity/:id/edit", requireRoles("admin"), async (req, res) => {
  const { entity, id } = req.params;
  const tab =
    Object.keys(TAB_ENTITY).find((k) => TAB_ENTITY[k].entity === entity) ||
    "posts";
  const db = await getDb();
  const cfg = TAB_ENTITY[tab];

  await db.run(`UPDATE ${cfg.table} SET deleted_at = NULL WHERE id = ?`, [id]);
  await logActivity(req.user.id, "restore", entity, id);

  const editPath =
    entity === "page"
      ? `/admin/pages/${id}/edit`
      : entity === "post"
      ? `/admin/posts/${id}/edit`
      : entity === "category"
      ? `/admin/categories/${id}/edit`
      : entity === "tag"
      ? `/admin/tags/${id}/edit`
      : entity === "media"
      ? `/admin/media/${id}/edit`
      : `/admin`;

  return res.redirect(editPath);
});

export default router;
