import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";
import { getSeo, saveSeo, getSeoDefaults } from "../services/seo.js";

const router = express.Router();

/* ===== LIST (BẢNG) ===== */
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  const rows = await db.all(
    `SELECT c.id, c.parent_id, c.order_index,
            ct.name AS title, ct.slug AS slug,
            pt.name AS parent_title,
            (SELECT COUNT(*) FROM posts_categories pc
              JOIN posts p ON p.id = pc.post_id AND p.deleted_at IS NULL
             WHERE pc.category_id = c.id) AS post_count
       FROM categories c
  LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
  LEFT JOIN categories p ON p.id = c.parent_id
  LEFT JOIN categories_translations pt ON pt.category_id=p.id AND pt.language=?
      WHERE c.deleted_at IS NULL
   ORDER BY (c.parent_id IS NOT NULL), c.parent_id, c.order_index, c.id`,
    [lang, lang]
  );

  res.render("categories/list", {
    pageTitle: "Danh mục",
    rows,
    ok: req.query.ok || "",
    err: req.query.err || "",
  });
});

/* ===== TREE VIEW ===== */
router.get("/tree", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  const flat = await db.all(
    `SELECT c.id, c.parent_id, c.order_index, ct.name AS title, ct.slug AS slug
       FROM categories c
  LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
      WHERE c.deleted_at IS NULL
   ORDER BY c.parent_id, c.order_index, c.id`,
    [lang]
  );

  const byId = new Map();
  flat.forEach(r => byId.set(r.id, { id:r.id, title:r.title, slug:r.slug, children:[] }));
  const roots = [];
  flat.forEach(r => { const node = byId.get(r.id); if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(node); else roots.push(node); });

  res.render("categories/tree", { pageTitle: "Danh mục (Tree)", tree: roots, lang });
});

/* ===== NEW (form) ===== */
router.get("/new", requireRoles("admin","editor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  const parents = await db.all(
    `SELECT c.id, COALESCE(t.name,'(Không tên)') AS name
       FROM categories c
  LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
      WHERE c.deleted_at IS NULL
   ORDER BY name`, [lang]
  );

  const seoDefaults = await getSeoDefaults();
  const seo = {
    title: "", meta_description: "", focus_keyword: "",
    robots_index: seoDefaults.seo_default_index || "index",
    robots_follow: seoDefaults.seo_default_follow || "follow",
    robots_advanced: "", canonical_url: "",
    schema_type: seoDefaults.seo_schema_default_type || "",
    schema_jsonld: seoDefaults.seo_schema_default_jsonld || "",
    og_title: "", og_description: "", og_image_url: "",
    twitter_title: "", twitter_description: "", twitter_image_url: "",
  };

  return res.render("categories/edit", {
    pageTitle: "Thêm danh mục",
    item: null,
    parents,
    error: null,
    csrfToken: res.locals.csrfToken || "",
    seo,
    seoDefaults,
  });
});

/* ===== NEW (submit) ===== */
router.post("/new", requireRoles("admin","editor"), async (req, res) => {
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
          WHERE (parent_id <=> ?)
            AND deleted_at IS NULL`, [parentId]
      );
      finalOrder = next?.next ?? 0;
    }

    await db.run(`INSERT INTO categories(parent_id, order_index) VALUES(?,?)`, [parentId, finalOrder]);
    const { id } = await db.get(`SELECT LAST_INSERT_ID() AS id`);

    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(theName);
    await db.run(
      `INSERT INTO categories_translations(category_id, language, name, slug, content_html)
       VALUES(?,?,?,?,?)`,
      [id, lang, theName, theSlug, content_html || ""]
    );

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

    return res.redirect("/admin/categories?ok=created");
  } catch (e) {
    const parents = await getDb().then(async (db2) => {
      const lg = await getSetting("default_language", "vi");
      return db2.all(
        `SELECT c.id, COALESCE(t.name,'(Không tên)') AS name
           FROM categories c
      LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
          WHERE c.deleted_at IS NULL
       ORDER BY name`, [lg]
      );
    });

    const seoDefaults = await getSeoDefaults();
    return res.render("categories/edit", {
      pageTitle: "Thêm danh mục",
      item: null,
      parents,
      error: e.message,
      csrfToken: res.locals.csrfToken || "",
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
      seoDefaults,
    });
  }
});

/* ===== EDIT (form) ===== */
router.get("/:id/edit", requireRoles("admin","editor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id = Number(req.params.id);

  const item = await db.get(
    `SELECT c.id, c.parent_id, c.order_index, t.name, t.slug, t.content_html
       FROM categories c
  LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
      WHERE c.id=? AND c.deleted_at IS NULL`, [lang, id]
  );
  if (!item) return res.status(404).send("Không tìm thấy danh mục");

  const parents = await db.all(
    `SELECT c.id, COALESCE(t.name,'(Không tên)') AS name
       FROM categories c
  LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
      WHERE c.deleted_at IS NULL AND c.id <> ?
   ORDER BY name`, [lang, id]
  );

  const seo = await getSeo("category", id, lang);
  const seoDefaults = await getSeoDefaults();

  return res.render("categories/edit", {
    pageTitle: "Sửa danh mục",
    item, parents,
    error: null,
    csrfToken: res.locals.csrfToken || "",
    seo, seoDefaults,
  });
});

/* ===== EDIT (submit) ===== */
router.post("/:id/edit", requireRoles("admin","editor"), async (req, res) => {
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
        const kids = await db.all(`SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL`, [cur]);
        kids.forEach(k => stack.push(k.id));
      }
    }

    await db.run(
      `UPDATE categories
          SET parent_id=?, order_index=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?`, [parentId, finalOrder, id]
    );

    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(theName);
    const exists = await db.get(
      `SELECT 1 FROM categories_translations WHERE category_id=? AND language=?`, [id, lang]
    );

    if (exists) {
      await db.run(
        `UPDATE categories_translations SET name=?, slug=?, content_html=? WHERE category_id=? AND language=?`,
        [theName, theSlug, content_html || "", id, lang]
      );
    } else {
      await db.run(
        `INSERT INTO categories_translations(category_id, language, name, slug, content_html)
         VALUES(?,?,?,?,?)`,
        [id, lang, theName, theSlug, content_html || ""]
      );
    }

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

    return res.redirect("/admin/categories?ok=updated");
  } catch (e) {
    const parents = await getDb().then(async (db2) => {
      return db2.all(
        `SELECT c.id, COALESCE(t.name,'(Không tên)') AS name
           FROM categories c
      LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
          WHERE c.deleted_at IS NULL AND c.id <> ?
       ORDER BY name`, [await getSetting("default_language","vi"), id]
      );
    });

    const item = await getDb().then(async (db2) => {
      return db2.get(
        `SELECT c.id, c.parent_id, c.order_index, t.name, t.slug, t.content_html
           FROM categories c
      LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
          WHERE c.id = ?`, [lang, id]
      );
    });

    const seo = await getSeo("category", id, lang).catch(() => ({}));
    const seoDefaults = await getSeoDefaults();

    return res.render("categories/edit", {
      pageTitle: "Sửa danh mục",
      item, parents,
      error: e.message,
      csrfToken: res.locals.csrfToken || "",
      seo, seoDefaults,
    });
  }
});

/* ===== REORDER ===== */
router.post("/reorder", requireRoles("admin","editor"), async (req, res) => {
  const db = await getDb();
  const { node_id, new_parent_id, new_index } = req.body;
  const nodeId = Number(node_id);
  const parentId = new_parent_id ? Number(new_parent_id) : null;
  const targetIndex = Number(new_index || 0);

  try {
    await db.exec("START TRANSACTION");

    if (parentId != null) {
      const stack = [parentId];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === nodeId) throw new Error("Không thể đặt danh mục cha là chính nó/hoặc con cháu của nó.");
        const kids = await db.all(`SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL`, [cur]);
        kids.forEach(k => stack.push(k.id));
      }
    }

    await db.run(`UPDATE categories SET parent_id=? WHERE id=?`, [parentId, nodeId]);

    const siblings = await db.all(
      `SELECT id FROM categories WHERE (parent_id <=> ?) AND deleted_at IS NULL AND id <> ?
         ORDER BY COALESCE(order_index,0), id`, [parentId, nodeId]
    );

    const arr = siblings.map(s => s.id);
    const idx = Math.max(0, Math.min(targetIndex, arr.length));
    arr.splice(idx, 0, nodeId);

    for (let i=0;i<arr.length;i++) {
      await db.run(`UPDATE categories SET order_index=? WHERE id=?`, [i, arr[i]]);
    }

    await db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { await db.exec("ROLLBACK"); } catch {}
    res.status(409).json({ ok: false, error: e.message });
  }
});

/* === Confirm Trash + Reassign & Trash === */
router.get("/:id/confirm-trash", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id = Number(req.params.id);

  const cat = await db.get(
    `SELECT c.id, ct.name AS name
       FROM categories c
  LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
      WHERE c.id=? AND c.deleted_at IS NULL`, [lang, id]
  );
  if (!cat) return res.status(404).json({ ok:false, error:"Không tìm thấy danh mục" });

  const countRow = await db.get(
    `SELECT COUNT(*) AS n
       FROM posts_categories pc
       JOIN posts p ON p.id=pc.post_id AND p.deleted_at IS NULL
      WHERE pc.category_id=?`, [id]
  );

  const posts = await db.all(
    `SELECT p.id, COALESCE(t.title,'(Không tên)') AS title
       FROM posts p
  LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
       JOIN posts_categories pc ON pc.post_id=p.id
      WHERE pc.category_id=? AND p.deleted_at IS NULL
   ORDER BY p.id DESC LIMIT 200`, [lang, id]
  );

  const others = await db.all(
    `SELECT c.id, COALESCE(ct.name,'(Không tên)') AS name
       FROM categories c
  LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
      WHERE c.deleted_at IS NULL AND c.id <> ?
   ORDER BY name`, [lang, id]
  );

  return res.json({
    ok: true,
    category: cat,
    count: countRow?.n || 0,
    posts,
    candidates: others,
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || "")
  });
});

router.post("/:id/reassign-and-trash", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const oldId = Number(req.params.id);
  const newId = Number(req.body.new_category_id || 0);
  const forcePrimary = String(req.body.force_primary || "") === "1";

  if (!newId) return res.status(400).json({ ok:false, error:"Vui lòng chọn danh mục đích" });
  if (newId === oldId) return res.status(400).json({ ok:false, error:"Danh mục đích không được trùng danh mục xoá" });

  try {
    await db.exec("START TRANSACTION");

    const links = await db.all(`SELECT post_id, is_primary FROM posts_categories WHERE category_id=?`, [oldId]);

    for (const row of links) {
      const pid = row.post_id;

      const exists = await db.get(`SELECT 1 FROM posts_categories WHERE post_id=? AND category_id=?`, [pid, newId]);
      if (!exists) await db.run(`INSERT INTO posts_categories(post_id, category_id, is_primary) VALUES (?,?,0)`, [pid, newId]);

      if (row.is_primary === 1 && forcePrimary) {
        await db.run(`UPDATE posts_categories SET is_primary=0 WHERE post_id=?`, [pid]);
        await db.run(`UPDATE posts_categories SET is_primary=1 WHERE post_id=? AND category_id=?`, [pid, newId]);
      }

      await db.run(`DELETE FROM posts_categories WHERE post_id=? AND category_id=?`, [pid, oldId]);
    }

    await db.run(`UPDATE categories SET deleted_at=CURRENT_TIMESTAMP WHERE id=?`, [oldId]);

    await db.exec("COMMIT");
    return res.json({ ok: true, message: "Đã chuyển Danh mục vào Thùng rác." });
  } catch (e) {
    try { await db.exec("ROLLBACK"); } catch {}
    return res.status(409).json({ ok:false, error: e.message || String(e) });
  }
});

export default router;
