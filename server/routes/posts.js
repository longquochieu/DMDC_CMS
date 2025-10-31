// server/routes/posts.js
import express from "express";
import sanitizeHtml from "sanitize-html";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

function cleanHtml(input) {
  const cfg = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "iframe",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      iframe: [
        "src",
        "width",
        "height",
        "frameborder",
        "allow",
        "referrerpolicy",
        "allowfullscreen",
      ],
      "*": ["style", "class", "align"],
    },
    allowedIframeHostnames: ["www.youtube.com", "youtube.com", "youtu.be"],
    transformTags: {
      iframe(tagName, attribs) {
        try {
          const url = new URL(attribs.src || "", "http://x");
          const host = url.hostname.replace(/^www\./, "");
          if (
            !["youtube.com", "youtu.be"].includes(host) &&
            host.indexOf("youtube.com") === -1
          ) {
            return { tagName: "p", text: "" };
          }
        } catch (e) {
          return { tagName: "p", text: "" };
        }
        attribs.referrerpolicy = "strict-origin-when-cross-origin";
        attribs.allow =
          attribs.allow ||
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        return { tagName: "iframe", attribs };
      },
    },
  };
  return sanitizeHtml(input || "", cfg);
}

// --------- Helpers ---------
async function loadCategoriesFlat(lang) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT c.id, c.parent_id, COALESCE(c.order_index,0) AS order_index,
            t.name AS title
     FROM categories c
     LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
     WHERE c.deleted_at IS NULL
     ORDER BY COALESCE(c.parent_id,0), c.order_index, c.id`,
    lang
  );
  // build tree
  const byParent = new Map();
  rows.forEach((r) => {
    const pid = r.parent_id || 0;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(r);
  });
  const out = [];
  (function dfs(parentId, depth) {
    const list = byParent.get(parentId || 0) || [];
    list.forEach((r) => {
      out.push({ ...r, depth });
      dfs(r.id, depth + 1);
    });
  })(0, 0);
  return out;
}

function parseGalleryIds(str) {
  if (!str) return [];
  return String(str)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function ensureFutureIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  return d.getTime() > now.getTime() ? d.toISOString().slice(0, 19).replace("T", " ") : null;
}

// --------- LIST ---------
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  const sortWhitelist = new Set([
    "title",
    "status",
    "created_at",
    "scheduled_at", // cột “Thời điểm đăng”
    "author",
  ]);
  const sort = sortWhitelist.has(req.query.sort) ? req.query.sort : "created_at";
  const dir = req.query.dir === "asc" ? "asc" : "desc";

  const items = await db.all(
    `
    SELECT p.id, p.status, p.created_at, p.scheduled_at, u.username AS author,
           t.title, t.slug,
           m.url AS featured_url
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    LEFT JOIN users u ON u.id=p.created_by
    LEFT JOIN media m ON m.id=p.featured_media_id
    WHERE p.deleted_at IS NULL
    ORDER BY ${
      sort === "title"
        ? "t.title"
        : sort === "status"
        ? "p.status"
        : sort === "scheduled_at"
        ? "p.scheduled_at"
        : sort === "author"
        ? "u.username"
        : "p.created_at"
    } ${dir}, p.id DESC
    `,
    lang
  );

  // categories per post
  const catMap = new Map();
  const cats = await db.all(
    `
    SELECT pc.post_id, ct.name AS title
    FROM posts_categories pc
    JOIN categories_translations ct
      ON ct.category_id=pc.category_id AND ct.language=?
    `,
    lang
  );
  cats.forEach((r) => {
    if (!catMap.has(r.post_id)) catMap.set(r.post_id, []);
    catMap.get(r.post_id).push(r.title);
  });

  res.render("posts/list", {
    pageTitle: "Bài viết",
    items: items.map((it) => ({
      ...it,
      categories: catMap.get(it.id) || [],
    })),
    sort,
    dir,
  });
});

// --------- NEW ---------
router.get("/new", requireRoles("admin", "editor", "author", "contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const categories = await loadCategoriesFlat(lang);

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  res.render("posts/edit", {
    pageTitle: "Tạo bài viết",
    item: null,
    categories,
    lang,
    error: null,
    ui: {
      display_date: today,
      created_at: now, // for UI only
    },
    selected: {
      category_ids: [],
      primary_category_id: null,
      tags: [],
      gallery_ids: [],
    },
  });
});

router.post("/new", requireRoles("admin", "editor", "author", "contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const {
    title,
    slug,
    content_html,
    status,
    display_date, // chỉ để render trên FE
    category_ids: catArray,
    primary_category_id,
    featured_media_id,
    gallery_media_ids,
    schedule_enable,
    scheduled_at,
  } = req.body;

  // validate danh mục
  const selectedCatIds = (Array.isArray(catArray) ? catArray : catArray ? [catArray] : [])
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  let primaryCatId = parseInt(primary_category_id, 10);
  if (selectedCatIds.length === 0) {
    const categories = await loadCategoriesFlat(lang);
    return res.status(400).render("posts/edit", {
      pageTitle: "Tạo bài viết",
      item: null,
      categories,
      lang,
      error: "Bạn chưa chọn danh mục, vui lòng chọn.",
      ui: { display_date: display_date || new Date().toISOString().slice(0, 10), created_at: new Date() },
      selected: { category_ids: selectedCatIds, primary_category_id: null, tags: [], gallery_ids: [] },
    });
  }
  if (selectedCatIds.length > 1 && (!primaryCatId || !selectedCatIds.includes(primaryCatId))) {
    // chọn danh mục có order_index lớn hơn làm chính nếu không chọn
    const rows = await db.all(
      `SELECT id FROM categories WHERE id IN (${selectedCatIds.map(() => "?").join(",")})
       ORDER BY COALESCE(order_index,0) DESC, id DESC LIMIT 1`,
      ...selectedCatIds
    );
    primaryCatId = rows?.[0]?.id || selectedCatIds[0];
  }

  // trạng thái + lịch
  let finalStatus = status || "draft";
  let finalScheduledAt = null;
  if (schedule_enable === "1" || finalStatus === "scheduled") {
    const valid = ensureFutureIso(scheduled_at);
    if (!valid) {
      const categories = await loadCategoriesFlat(lang);
      return res.status(400).render("posts/edit", {
        pageTitle: "Tạo bài viết",
        item: null,
        categories,
        lang,
        error: "Thời điểm lên lịch phải ở tương lai.",
        ui: { display_date: display_date || new Date().toISOString().slice(0, 10), created_at: new Date() },
        selected: { category_ids: selectedCatIds, primary_category_id: primaryCatId, tags: [], gallery_ids: [] },
      });
    }
    finalStatus = "scheduled";
    finalScheduledAt = valid.replace(" ", " ");
  }

  const theSlug = slug?.trim() ? toSlug(slug) : toSlug(title);
  const cleanedHtml = cleanHtml(content_html);

  await db.run("BEGIN");
  try {
    // posts
    await db.run(
      `INSERT INTO posts(status, created_by, updated_by, primary_category_id, featured_media_id, display_date, scheduled_at)
       VALUES(?,?,?,?,?,?,?)`,
      finalStatus,
      req.user.id,
      req.user.id,
      primaryCatId || null,
      featured_media_id ? parseInt(featured_media_id, 10) : null,
      display_date || null,
      finalScheduledAt
    );
    const row = await db.get("SELECT last_insert_rowid() AS id");
    const postId = row.id;

    // translation
    await db.run(
      `INSERT INTO posts_translations(post_id, language, title, slug, content_html)
       VALUES(?,?,?,?,?)`,
      postId,
      lang,
      title || "",
      theSlug || "",
      cleanedHtml || ""
    );

    // post-categories
    await db.run("DELETE FROM posts_categories WHERE post_id=?", postId);
    for (const cid of selectedCatIds) {
      await db.run("INSERT OR IGNORE INTO posts_categories(post_id, category_id) VALUES(?,?)", postId, cid);
    }

    // gallery (media_usages)
    const galIds = parseGalleryIds(gallery_media_ids);
    await db.run('DELETE FROM media_usages WHERE post_id=? AND field="gallery"', postId);
    for (let i = 0; i < galIds.length; i++) {
      await db.run(
        'INSERT INTO media_usages(post_id, media_id, field, position) VALUES(?,?, "gallery", ?)',
        postId,
        galIds[i],
        i
      );
    }

    await db.run("COMMIT");
    await logActivity(req.user.id, "create", "post", postId);
    return res.redirect("/admin/posts");
  } catch (e) {
    await db.run("ROLLBACK");
    const categories = await loadCategoriesFlat(lang);
    return res.status(500).render("posts/edit", {
      pageTitle: "Tạo bài viết",
      item: null,
      categories,
      lang,
      error: e.message,
      ui: { display_date: display_date || new Date().toISOString().slice(0, 10), created_at: new Date() },
      selected: {
        category_ids: selectedCatIds,
        primary_category_id: primaryCatId || null,
        tags: [],
        gallery_ids: parseGalleryIds(gallery_media_ids),
      },
    });
  }
});

// --------- EDIT ---------
router.get("/:id/edit", requireRoles("admin", "editor", "author", "contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id = parseInt(req.params.id, 10);

  const categories = await loadCategoriesFlat(lang);
  const item = await db.get(
    `SELECT p.*, t.title, t.slug, t.content_html, m.url AS featured_url
     FROM posts p
     LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
     LEFT JOIN media m ON m.id=p.featured_media_id
     WHERE p.id=?`,
    lang,
    id
  );

  // selected categories
  const chosenRows = await db.all("SELECT category_id FROM posts_categories WHERE post_id=?", id);
  const chosenIds = chosenRows.map((r) => r.category_id);

  // gallery
  const gallery = await db.all(
    `SELECT m.id, m.url, mu.position
     FROM media_usages mu
     JOIN media m ON m.id = mu.media_id
     WHERE mu.post_id=? AND mu.field="gallery"
     ORDER BY mu.position, m.id`,
    id
  );

  res.render("posts/edit", {
    pageTitle: "Sửa bài viết",
    item,
    categories,
    lang,
    error: null,
    ui: {
      display_date: item?.display_date || new Date().toISOString().slice(0, 10),
      created_at: item?.created_at ? new Date(item.created_at) : new Date(),
    },
    selected: {
      category_ids: chosenIds,
      primary_category_id: item?.primary_category_id || null,
      tags: [],
      gallery_ids: gallery.map((g) => g.id),
    },
  });
});

router.post("/:id/edit", requireRoles("admin", "editor", "author", "contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const id = parseInt(req.params.id, 10);

  const {
    title,
    slug,
    content_html,
    status,
    display_date,
    category_ids: catArray,
    primary_category_id,
    featured_media_id,
    gallery_media_ids,
    schedule_enable,
    scheduled_at,
  } = req.body;

  const selectedCatIds = (Array.isArray(catArray) ? catArray : catArray ? [catArray] : [])
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  let primaryCatId = parseInt(primary_category_id, 10);
  if (selectedCatIds.length === 0) {
    const categories = await loadCategoriesFlat(lang);
    const item = await db.get(
      `SELECT p.*, t.title, t.slug, t.content_html, m.url AS featured_url
       FROM posts p
       LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
       LEFT JOIN media m ON m.id=p.featured_media_id
       WHERE p.id=?`,
      lang,
      id
    );
    return res.status(400).render("posts/edit", {
      pageTitle: "Sửa bài viết",
      item,
      categories,
      lang,
      error: "Bạn chưa chọn danh mục, vui lòng chọn.",
      ui: { display_date: display_date || new Date().toISOString().slice(0, 10), created_at: new Date(item?.created_at || new Date()) },
      selected: {
        category_ids: selectedCatIds,
        primary_category_id: primaryCatId || null,
        tags: [],
        gallery_ids: parseGalleryIds(gallery_media_ids),
      },
    });
  }
  if (selectedCatIds.length > 1 && (!primaryCatId || !selectedCatIds.includes(primaryCatId))) {
    const rows = await db.all(
      `SELECT id FROM categories WHERE id IN (${selectedCatIds.map(() => "?").join(",")})
       ORDER BY COALESCE(order_index,0) DESC, id DESC LIMIT 1`,
      ...selectedCatIds
    );
    primaryCatId = rows?.[0]?.id || selectedCatIds[0];
  }

  let finalStatus = status || "draft";
  let finalScheduledAt = null;
  if (schedule_enable === "1" || finalStatus === "scheduled") {
    const valid = ensureFutureIso(scheduled_at);
    if (!valid) {
      const categories = await loadCategoriesFlat(lang);
      const item = await db.get(
        `SELECT p.*, t.title, t.slug, t.content_html, m.url AS featured_url
         FROM posts p
         LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
         LEFT JOIN media m ON m.id=p.featured_media_id
         WHERE p.id=?`,
        lang,
        id
      );
      return res.status(400).render("posts/edit", {
        pageTitle: "Sửa bài viết",
        item,
        categories,
        lang,
        error: "Thời điểm lên lịch phải ở tương lai.",
        ui: { display_date, created_at: new Date(item?.created_at || new Date()) },
        selected: {
          category_ids: selectedCatIds,
          primary_category_id: primaryCatId || null,
          tags: [],
          gallery_ids: parseGalleryIds(gallery_media_ids),
        },
      });
    }
    finalStatus = "scheduled";
    finalScheduledAt = valid.replace(" ", " ");
  }

  const theSlug = slug?.trim() ? toSlug(slug) : toSlug(title);
  const cleanedHtml = cleanHtml(content_html);

  await db.run("BEGIN");
  try {
    await db.run(
      `UPDATE posts
       SET status=?, updated_by=?, primary_category_id=?, featured_media_id=?, display_date=?, scheduled_at=?
       WHERE id=?`,
      finalStatus,
      req.user.id,
      primaryCatId || null,
      featured_media_id ? parseInt(featured_media_id, 10) : null,
      display_date || null,
      finalScheduledAt,
      id
    );

    await db.run(
      `UPDATE posts_translations
       SET title=?, slug=?, content_html=?
       WHERE post_id=? AND language=?`,
      title || "",
      theSlug || "",
      cleanedHtml || "",
      id,
      lang
    );

    await db.run("DELETE FROM posts_categories WHERE post_id=?", id);
    for (const cid of selectedCatIds) {
      await db.run("INSERT OR IGNORE INTO posts_categories(post_id, category_id) VALUES(?,?)", id, cid);
    }

    const galIds = parseGalleryIds(gallery_media_ids);
    await db.run('DELETE FROM media_usages WHERE post_id=? AND field="gallery"', id);
    for (let i = 0; i < galIds.length; i++) {
      await db.run(
        'INSERT INTO media_usages(post_id, media_id, field, position) VALUES(?,?, "gallery", ?)',
        id,
        galIds[i],
        i
      );
    }

    await db.run("COMMIT");
    await logActivity(req.user.id, "update", "post", id);
    return res.redirect("/admin/posts");
  } catch (e) {
    await db.run("ROLLBACK");
    const categories = await loadCategoriesFlat(lang);
    const item = await db.get(
      `SELECT p.*, t.title, t.slug, t.content_html, m.url AS featured_url
       FROM posts p
       LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
       LEFT JOIN media m ON m.id=p.featured_media_id
       WHERE p.id=?`,
      lang,
      id
    );
    return res.status(500).render("posts/edit", {
      pageTitle: "Sửa bài viết",
      item,
      categories,
      lang,
      error: e.message,
      ui: { display_date, created_at: new Date(item?.created_at || new Date()) },
      selected: {
        category_ids: selectedCatIds,
        primary_category_id: primaryCatId || null,
        tags: [],
        gallery_ids: parseGalleryIds(gallery_media_ids),
      },
    });
  }
});

// --------- SOFT DELETE ---------
router.post("/:id/trash", requireRoles("admin", "editor"), async (req, res) => {
  const db = await getDb();
  const id = parseInt(req.params.id, 10);
  await db.run('UPDATE posts SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', id);
  await logActivity(req.user.id, "trash", "post", id);
  res.redirect("/admin/posts");
});

export default router;
