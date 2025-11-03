// server/routes/categories.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";
import { getCategoriesTree } from "../services/categories_tree.js";
import { getSeo, saveSeo, getSeoDefaults } from "../services/seo.js";

const router = express.Router();

/* ===== LIST (BẢNG) ===== */
router.get('/', requireAuth, async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting('default_language', 'vi');

  const rows = await db.all(`
    SELECT
      c.id,
      c.parent_id,
      c.order_index,
      c.created_at,
      c.created_by,
      u.username        AS author,
      ct.name           AS title,
      ct.slug           AS slug,
      pt.name           AS parent_title,
      (
        SELECT COUNT(*)
        FROM posts_categories pc
        JOIN posts p ON p.id = pc.post_id AND p.deleted_at IS NULL
        WHERE pc.category_id = c.id
      ) AS post_count
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    LEFT JOIN categories p
      ON p.id = c.parent_id
    LEFT JOIN categories_translations pt
      ON pt.category_id = p.id AND pt.language = ?
    LEFT JOIN users u
      ON u.id = c.created_by
    WHERE c.deleted_at IS NULL
    ORDER BY (c.parent_id IS NOT NULL), c.parent_id, c.order_index, c.id
  `, [lang, lang]);

  res.render('categories/list', {
    pageTitle: 'Danh mục',
    rows
  });
});

/* ===== TREE VIEW ===== */
router.get('/tree', requireAuth, async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting('default_language', 'vi');

  const flat = await db.all(`
    SELECT
      c.id, c.parent_id, c.order_index,
      ct.name AS title,
      ct.slug AS slug
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY c.parent_id, c.order_index, c.id
  `, [lang]);

  const byId = new Map();
  flat.forEach(r => byId.set(r.id, { id: r.id, title: r.title, slug: r.slug, children: [] }));
  const roots = [];
  flat.forEach(r => {
    const node = byId.get(r.id);
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(node);
    else roots.push(node);
  });

  res.render('categories/tree', {
    pageTitle: 'Danh mục (Tree)',
    tree: roots,
    lang
  });
});

/* ===== NEW (form) ===== */
router.get("/new", requireRoles("admin", "editor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  const parents = await db.all(
    `SELECT c.id, COALESCE(t.name, '(Không tên)') AS name
       FROM categories c
  LEFT JOIN categories_translations t
         ON t.category_id = c.id AND t.language = ?
      WHERE c.deleted_at IS NULL
   ORDER BY name`,
    [lang]
  );

  const seoDefaults = await getSeoDefaults();
  const seo = {
    title: "",
    meta_description: "",
    focus_keyword: "",
    robots_index: seoDefaults.seo_default_index || "index",
    robots_follow: seoDefaults.seo_default_follow || "follow",
    robots_advanced: "",
    canonical_url: "",
    schema_type: seoDefaults.seo_schema_default_type || "",
    schema_jsonld: seoDefaults.seo_schema_default_jsonld || "",
    og_title: "",
    og_description: "",
    og_image_url: "",
    twitter_title: "",
    twitter_description: "",
    twitter_image_url: "",
  };

  return res.render("categories/edit", {
    pageTitle: "Thêm danh mục",
    item: null,
    parents,
    error: null,
    csrfToken: (res.locals.csrfToken || ""),
    seo,
    seoDefaults
  });
});

/* ===== NEW (submit) ===== */
router.post("/new", requireRoles("admin", "editor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  try {
    const { name, slug, parent_id, order_index, content_html } = req.body;
    const theName = (name || "").trim();
    if (!theName) throw new Error("Vui lòng nhập tên danh mục");

    const parentId = parent_id ? Number(parent_id) : null;

    let finalOrder = Number.isFinite(Number(order_index)) ? Number(order_index) : null;
    if (finalOrder === null) {
      const next = await db.get(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS next
         FROM categories
         WHERE (parent_id IS ? OR (parent_id IS NULL AND ? IS NULL))
           AND deleted_at IS NULL`,
        [parentId, parentId]
      );
      finalOrder = next?.next ?? 0;
    }

    await db.run(
      `INSERT INTO categories(parent_id, order_index, created_by, updated_by)
       VALUES(?,?,?,?)`,
      [parentId, finalOrder, req.user.id, req.user.id]
    );
    const { id } = await db.get(`SELECT last_insert_rowid() AS id`);

    const theSlug = (slug && slug.trim()) ? toSlug(slug) : toSlug(theName);
    await db.run(
      `INSERT INTO categories_translations(category_id, language, name, slug, content_html)
       VALUES(?,?,?,?,?)`,
      [id, lang, theName, theSlug, content_html || ""]
    );

    // --- SAVE SEO ---
    const seoPayload = {
      title: req.body.seo_title || "",
      meta_description: req.body.seo_description || "",
      focus_keyword: req.body.seo_focus_keyword || "",
      robots_index: req.body.seo_robots_index || "",
      robots_follow: req.body.seo_robots_follow || "",
      robots_advanced: req.body.seo_robots_advanced || "",
      canonical_url: req.body.seo_canonical_url || "",
      schema_type: req.body.seo_schema_type || "",
      schema_jsonld: req.body.seo_schema_jsonld || "",
      og_title: req.body.seo_og_title || "",
      og_description: req.body.seo_og_description || "",
      og_image_url: req.body.seo_og_image_url || "",
      twitter_title: req.body.seo_twitter_title || "",
      twitter_description: req.body.seo_twitter_description || "",
      twitter_image_url: req.body.seo_twitter_image_url || "",
    };
    await saveSeo("category", id, lang, seoPayload);
    // ---------------

    return res.redirect("/admin/categories");
  } catch (e) {
    const parents = await getDb().then(async (db2) => {
      const lg = await getSetting("default_language", "vi");
      return db2.all(
        `SELECT c.id, COALESCE(t.name, '(Không tên)') AS name
           FROM categories c
      LEFT JOIN categories_translations t
             ON t.category_id = c.id AND t.language = ?
          WHERE c.deleted_at IS NULL
       ORDER BY name`,
        [lg]
      );
    });

    const seoDefaults = await getSeoDefaults();
    return res.render("categories/edit", {
      pageTitle: "Thêm danh mục",
      item: null,
      parents,
      error: e.message,
      csrfToken: (res.locals.csrfToken || ""),
      seo: {
        title: req.body.seo_title || "",
        meta_description: req.body.seo_description || "",
        focus_keyword: req.body.seo_focus_keyword || "",
        robots_index: req.body.seo_robots_index || "",
        robots_follow: req.body.seo_robots_follow || "",
        robots_advanced: req.body.seo_robots_advanced || "",
        canonical_url: req.body.seo_canonical_url || "",
        schema_type: req.body.seo_schema_type || "",
        schema_jsonld: req.body.seo_schema_jsonld || "",
        og_title: req.body.seo_og_title || "",
        og_description: req.body.seo_og_description || "",
        og_image_url: req.body.seo_og_image_url || "",
        twitter_title: req.body.seo_twitter_title || "",
        twitter_description: req.body.seo_twitter_description || "",
        twitter_image_url: req.body.seo_twitter_image_url || "",
      },
      seoDefaults
    });
  }
});

/* ===== EDIT (form) ===== */
router.get("/:id/edit", requireRoles("admin", "editor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id = Number(req.params.id);

  const item = await db.get(
    `SELECT c.id, c.parent_id, c.order_index, c.created_at, c.updated_at,
            t.name, t.slug, t.content_html
       FROM categories c
  LEFT JOIN categories_translations t
         ON t.category_id = c.id AND t.language = ?
      WHERE c.id = ? AND c.deleted_at IS NULL`,
    [lang, id]
  );
  if (!item) return res.status(404).send("Không tìm thấy danh mục");

  const parents = await db.all(
    `SELECT c.id, COALESCE(t.name, '(Không tên)') AS name
       FROM categories c
  LEFT JOIN categories_translations t
         ON t.category_id = c.id AND t.language = ?
      WHERE c.deleted_at IS NULL AND c.id != ?
   ORDER BY name`,
    [lang, id]
  );

  const seo = await getSeo("category", id, lang);
  const seoDefaults = await getSeoDefaults();

  return res.render("categories/edit", {
    pageTitle: "Sửa danh mục",
    item,
    parents,
    error: null,
    csrfToken: (res.locals.csrfToken || ""),
    seo,
    seoDefaults
  });
});

/* ===== EDIT (submit) ===== */
router.post("/:id/edit", requireRoles("admin", "editor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id = Number(req.params.id);

  try {
    const { name, slug, parent_id, order_index, content_html } = req.body;
    const theName = (name || "").trim();
    if (!theName) throw new Error("Vui lòng nhập tên danh mục");

    const parentId = parent_id ? Number(parent_id) : null;
    const finalOrder = Number.isFinite(Number(order_index)) ? Number(order_index) : 0;

    // Chặn vòng lặp
    if (parentId) {
      const stack = [parentId];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === id) throw new Error("Không thể đặt danh mục cha là chính nó/hoặc con cháu của nó.");
        const kids = await db.all(`SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL`, [cur]);
        kids.forEach(k => stack.push(k.id));
      }
    }

    await db.run(
      `UPDATE categories
          SET parent_id = ?, order_index = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [parentId, finalOrder, req.user.id, id]
    );

    const theSlug = (slug && slug.trim()) ? toSlug(slug) : toSlug(theName);
    const exists = await db.get(
      `SELECT 1 FROM categories_translations WHERE category_id = ? AND language = ?`,
      [id, lang]
    );

    if (exists) {
      await db.run(
        `UPDATE categories_translations SET name = ?, slug = ?, content_html=? WHERE category_id = ? AND language = ?`,
        [theName, theSlug, content_html || "", id, lang]
      );
    } else {
      await db.run(
        `INSERT INTO categories_translations(category_id, language, name, slug, content_html)
         VALUES(?,?,?,?,?)`,
        [id, lang, theName, theSlug, content_html || ""]
      );
    }

    // --- SAVE SEO ---
    const seoPayload = {
      title: req.body.seo_title || "",
      meta_description: req.body.seo_description || "",
      focus_keyword: req.body.seo_focus_keyword || "",
      robots_index: req.body.seo_robots_index || "",
      robots_follow: req.body.seo_robots_follow || "",
      robots_advanced: req.body.seo_robots_advanced || "",
      canonical_url: req.body.seo_canonical_url || "",
      schema_type: req.body.seo_schema_type || "",
      schema_jsonld: req.body.seo_schema_jsonld || "",
      og_title: req.body.seo_og_title || "",
      og_description: req.body.seo_og_description || "",
      og_image_url: req.body.seo_og_image_url || "",
      twitter_title: req.body.seo_twitter_title || "",
      twitter_description: req.body.seo_twitter_description || "",
      twitter_image_url: req.body.seo_twitter_image_url || "",
    };
    await saveSeo("category", id, lang, seoPayload);
    // ---------------

    return res.redirect("/admin/categories");
  } catch (e) {
    const parents = await getDb().then(async (db2) => {
      return db2.all(
        `SELECT c.id, COALESCE(t.name, '(Không tên)') AS name
           FROM categories c
      LEFT JOIN categories_translations t
             ON t.category_id = c.id AND t.language = ?
          WHERE c.deleted_at IS NULL AND c.id != ?
       ORDER BY name`,
        [await getSetting("default_language", "vi"), id]
      );
    });

    const item = await getDb().then(async (db2) => {
      return db2.get(
        `SELECT c.id, c.parent_id, c.order_index, c.created_at, c.updated_at,
                t.name, t.slug, t.content_html
           FROM categories c
      LEFT JOIN categories_translations t
             ON t.category_id = c.id AND t.language = ?
          WHERE c.id = ?`,
        [lang, id]
      );
    });

    const seo = await getSeo("category", id, lang).catch(() => ({}));
    const seoDefaults = await getSeoDefaults();

    return res.render("categories/edit", {
      pageTitle: "Sửa danh mục",
      item,
      parents,
      error: e.message,
      csrfToken: (res.locals.csrfToken || ""),
      seo,
      seoDefaults
    });
  }
});

/* ===== REORDER ===== */
router.post("/reorder", requireRoles("admin", "editor"), async (req, res) => {
  const db = await getDb();
  const { node_id, new_parent_id, new_index } = req.body;
  const nodeId = Number(node_id);
  const parentId = new_parent_id ? Number(new_parent_id) : null;
  const targetIndex = Number(new_index || 0);

  try {
    await db.run("BEGIN IMMEDIATE");

    if (parentId) {
      const stack = [parentId];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === nodeId) {
          throw new Error("Không thể đặt danh mục cha là chính nó/hoặc con cháu của nó.");
        }
        const kids = await db.all(
          `SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL`,
          [cur]
        );
        kids.forEach(k => stack.push(k.id));
      }
    }

    await db.run(
      `UPDATE categories SET parent_id = ? WHERE id = ?`,
      [parentId, nodeId]
    );

    const siblings = await db.all(
      `SELECT id
         FROM categories
        WHERE (parent_id IS ? OR (parent_id IS NULL AND ? IS NULL))
          AND deleted_at IS NULL
        ORDER BY COALESCE(order_index,0), id`,
      [parentId, parentId]
    );

    const arranged = [];
    const filtered = siblings.map(s => s.id).filter(id => id !== nodeId);
    for (let i = 0; i <= filtered.length; i++) {
      if (i === targetIndex) arranged.push(nodeId);
      if (i < filtered.length) arranged.push(filtered[i]);
    }

    for (let i = 0; i < arranged.length; i++) {
      await db.run(`UPDATE categories SET order_index = ? WHERE id = ?`, [i, arranged[i]]);
    }

    await db.run("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await db.run("ROLLBACK");
    res.status(409).json({ ok: false, error: e.message });
  }
});

/* ===== TRASH ===== */
router.post("/:id/trash", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);

  const hasChild = await db.get(
    `SELECT 1 FROM categories WHERE parent_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (hasChild) {
    return res.redirect("/admin/categories?err=has_children");
  }

  const hasPosts = await db.get(
    `SELECT 1
       FROM posts_categories pc
       JOIN posts p ON p.id = pc.post_id AND p.deleted_at IS NULL
      WHERE pc.category_id = ?
      LIMIT 1`,
    [id]
  );
  if (hasPosts) {
    return res.redirect("/admin/categories?err=has_posts");
  }

  await db.run(`UPDATE categories SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  return res.redirect("/admin/categories?ok=trashed");
});

export default router;
