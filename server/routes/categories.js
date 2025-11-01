// server/routes/categories.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";

const router = express.Router();

/* -------------------------------------------------
   LIST (BẢNG)
   - /admin/categories      → danh sách dạng bảng
   - /admin/categories/table → alias, redirect về /admin/categories
--------------------------------------------------*/
router.get("/", requireAuth, async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");

  // danh sách + tên cha + (tuỳ chọn) đếm số bài viết mỗi danh mục
  const rows = await db.all(
    `
    SELECT
      c.id,
      c.parent_id,
      c.order_index,
      c.created_at,
      ct.name  AS title,
      ct.slug  AS slug,
      pt.name  AS parent_title,
      (SELECT COUNT(1)
         FROM posts_categories pc
         JOIN posts p ON p.id = pc.post_id AND p.deleted_at IS NULL
        WHERE pc.category_id = c.id) AS posts_count
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    LEFT JOIN categories p
      ON p.id = c.parent_id
    LEFT JOIN categories_translations pt
      ON pt.category_id = p.id AND pt.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY (c.parent_id IS NOT NULL), c.parent_id, COALESCE(c.order_index,0), c.id
    `,
    [lang, lang]
  );

  res.render("categories/list", {
    pageTitle: "Danh mục (Bảng)",
    rows,
    csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : "")
  });
});

// alias cũ nếu template nào đó còn trỏ /table
router.get("/table", (req, res) => res.redirect("/admin/categories"));

/* -------------------------------------------------
   TREE VIEW
   - /admin/categories/tree → hiển thị cây + drag&drop
--------------------------------------------------*/
router.get("/tree", requireAuth, async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");

  const flat = await db.all(
    `
    SELECT
      c.id, c.parent_id, c.order_index,
      ct.name AS title,
      ct.slug AS slug
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY c.parent_id, COALESCE(c.order_index,0), c.id
    `,
    [lang]
  );

  // Build tree
  const byId = new Map();
  flat.forEach(r => byId.set(r.id, { id: r.id, title: r.title, slug: r.slug, children: [] }));
  const roots = [];
  flat.forEach(r => {
    const node = byId.get(r.id);
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(node);
    else roots.push(node);
  });

  res.render("categories/tree", {
    pageTitle: "Danh mục (Tree)",
    tree: roots,
    lang,
    csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : "")
  });
});

/* -------------------------------------------------
   REORDER (AJAX)
   body: { node_id, new_parent_id, new_index }
--------------------------------------------------*/
router.post("/reorder", requireRoles("admin","editor"), async (req, res) => {
  const db = await getDb();
  const nodeId     = Number(req.body.node_id);
  const parentId   = req.body.new_parent_id ? Number(req.body.new_parent_id) : null;
  const targetIdx  = Number(req.body.new_index || 0);

  try {
    await db.run("BEGIN");

    // chặn vòng lặp (đưa làm con của chính nó/descendant)
    if (parentId) {
      const stack = [parentId];
      while (stack.length) {
        const x = stack.pop();
        if (x === nodeId) throw new Error("Không thể đặt làm con của chính nó.");
        const kids = await db.all(
          `SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL`,
          [x]
        );
        kids.forEach(k => stack.push(k.id));
      }
    }

    // cập nhật parent_id
    await db.run(`UPDATE categories SET parent_id = ? WHERE id = ?`, [parentId, nodeId]);

    // lấy siblings theo parent mới
    const siblings = await db.all(
      `
      SELECT id FROM categories
       WHERE deleted_at IS NULL AND (
              (parent_id IS NULL AND ? IS NULL)
           OR  parent_id = ?
       )
       ORDER BY COALESCE(order_index,0), id
      `,
      [parentId, parentId]
    );

    // sắp xếp order_index liên tục, chèn node vào vị trí targetIdx
    const filtered = siblings.map(s => s.id).filter(id => id !== nodeId);
    const clamped  = Math.max(0, Math.min(targetIdx, filtered.length));
    filtered.splice(clamped, 0, nodeId);

    for (let i = 0; i < filtered.length; i++) {
      await db.run(`UPDATE categories SET order_index = ? WHERE id = ?`, [i, filtered[i]]);
    }

    await db.run("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await db.run("ROLLBACK");
    res.status(409).json({ ok:false, error: e.message });
  }
});

/* -------------------------------------------------
   NEW
--------------------------------------------------*/
router.get("/new", requireRoles("admin","editor"), async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");

  const parents = await db.all(
    `
    SELECT c.id, COALESCE(t.name, '(Không tên)') AS name
      FROM categories c
 LEFT JOIN categories_translations t
        ON t.category_id = c.id AND t.language = ?
     WHERE c.deleted_at IS NULL
  ORDER BY name
    `,
    [lang]
  );

  res.render("categories/edit", {
    pageTitle: "Thêm danh mục",
    item: null,
    parents,
    error: null,
    csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : "")
  });
});

router.post("/new", requireRoles("admin","editor"), async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");

  try {
    const { name, slug, parent_id, order_index } = req.body;
    const theName = (name || "").trim();
    if (!theName) throw new Error("Vui lòng nhập tên danh mục");

    const parentId  = parent_id ? Number(parent_id) : null;
    let   finalSort = Number.isFinite(Number(order_index)) ? Number(order_index) : null;

    if (finalSort === null) {
      const next = await db.get(
        `
        SELECT COALESCE(MAX(order_index), -1) + 1 AS next
          FROM categories
         WHERE deleted_at IS NULL AND (
               (parent_id IS NULL AND ? IS NULL) OR parent_id = ?
         )
        `,
        [parentId, parentId]
      );
      finalSort = next?.next ?? 0;
    }

    await db.run(
      `INSERT INTO categories(parent_id, order_index, created_by, updated_by)
       VALUES(?,?,?,?)`,
      [parentId, finalSort, req.user.id, req.user.id]
    );
    const { id } = await db.get(`SELECT last_insert_rowid() AS id`);

    const theSlug = (slug && slug.trim()) ? toSlug(slug) : toSlug(theName);
    await db.run(
      `INSERT INTO categories_translations(category_id, language, name, slug)
       VALUES(?,?,?,?)`,
      [id, lang, theName, theSlug]
    );

    res.redirect("/admin/categories");
  } catch (e) {
    res.redirect("/admin/categories?err=" + encodeURIComponent(e.message));
  }
});

/* -------------------------------------------------
   EDIT
--------------------------------------------------*/
router.get("/:id/edit", requireRoles("admin","editor"), async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id   = Number(req.params.id);

  const item = await db.get(
    `
    SELECT c.id, c.parent_id, c.order_index, c.created_at, c.updated_at,
           t.name, t.slug
      FROM categories c
 LEFT JOIN categories_translations t
        ON t.category_id = c.id AND t.language = ?
     WHERE c.id = ? AND c.deleted_at IS NULL
    `,
    [lang, id]
  );
  if (!item) return res.status(404).send("Không tìm thấy danh mục");

  const parents = await db.all(
    `
    SELECT c.id, COALESCE(t.name, '(Không tên)') AS name
      FROM categories c
 LEFT JOIN categories_translations t
        ON t.category_id = c.id AND t.language = ?
     WHERE c.deleted_at IS NULL AND c.id != ?
  ORDER BY name
    `,
    [lang, id]
  );

  res.render("categories/edit", {
    pageTitle: "Sửa danh mục",
    item,
    parents,
    error: null,
    csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : "")
  });
});

router.post("/:id/edit", requireRoles("admin","editor"), async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id   = Number(req.params.id);

  try {
    const { name, slug, parent_id, order_index } = req.body;
    const theName  = (name || "").trim();
    if (!theName) throw new Error("Vui lòng nhập tên danh mục");

    const parentId  = parent_id ? Number(parent_id) : null;
    const finalSort = Number.isFinite(Number(order_index)) ? Number(order_index) : 0;

    // chặn vòng lặp
    if (parentId) {
      const stack = [parentId];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === id) throw new Error("Không thể đặt danh mục cha là chính nó/hoặc con cháu của nó.");
        const kids = await db.all(
          `SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL`,
          [cur]
        );
        kids.forEach(k => stack.push(k.id));
      }
    }

    await db.run(
      `
      UPDATE categories
         SET parent_id = ?, order_index = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
      `,
      [parentId, finalSort, req.user.id, id]
    );

    const theSlug = (slug && slug.trim()) ? toSlug(slug) : toSlug(theName);
    const exists  = await db.get(
      `SELECT 1 FROM categories_translations WHERE category_id = ? AND language = ?`,
      [id, lang]
    );

    if (exists) {
      await db.run(
        `UPDATE categories_translations SET name = ?, slug = ? WHERE category_id = ? AND language = ?`,
        [theName, theSlug, id, lang]
      );
    } else {
      await db.run(
        `INSERT INTO categories_translations(category_id, language, name, slug)
         VALUES(?,?,?,?)`,
        [id, lang, theName, theSlug]
      );
    }

    res.redirect("/admin/categories");
  } catch (e) {
    res.redirect("/admin/categories?err=" + encodeURIComponent(e.message));
  }
});

/* -------------------------------------------------
   TRASH (SOFT DELETE)
--------------------------------------------------*/
router.post("/:id/trash", requireRoles("admin"), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);

  // chặn xoá nếu còn con
  const hasChild = await db.get(
    `SELECT 1 FROM categories WHERE parent_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (hasChild) return res.redirect("/admin/categories?err=has_children");

  // chặn xoá nếu còn post
  const hasPosts = await db.get(
    `
    SELECT 1
      FROM posts_categories pc
      JOIN posts p ON p.id = pc.post_id AND p.deleted_at IS NULL
     WHERE pc.category_id = ?
     LIMIT 1
    `,
    [id]
  );
  if (hasPosts) return res.redirect("/admin/categories?err=has_posts");

  await db.run(`UPDATE categories SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  res.redirect("/admin/categories?ok=trashed");
});

export default router;
