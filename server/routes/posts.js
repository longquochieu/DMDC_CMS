// server/routes/posts.js
import express from "express";
import sanitizeHtml from "sanitize-html";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";

const router = express.Router();

/* ----------------------------- Time helpers ----------------------------- */
/** format UTC (ISO or sqlite datetime) -> 'dd/MM/yyyy HH:mm' in given timeZone */
function formatUtcToTZ(utcStr, timeZone) {
  if (!utcStr) return "";
  const d = new Date(utcStr);
  const fmt = new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/**
 * Parse value từ <input type="datetime-local"> (VD: "2025-10-31T14:35")
 * coi đó là "giờ treo tường" trong timeZone => đổi về UTC ISO string.
 * Thuật toán không cần thư viện ngoài.
 */
function parseLocalToUTC(localDT, timeZone) {
  if (!localDT) return null; // nothing
  // tách "YYYY-MM-DDTHH:mm"
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDT.trim());
  if (!m) return null;
  const [ , y, mm, dd, hh, mi ] = m.map(Number);
  // B1: tạo "ngày UTC" từ components (coi là UTC tạm)
  const asUTC = new Date(Date.UTC(y, mm - 1, dd, hh, mi, 0, 0));
  // B2: tính chênh lệch offset của timeZone tại thời điểm đó
  const tzDate = new Date(asUTC.toLocaleString("en-US", { timeZone }));
  const offsetMs = asUTC.getTime() - tzDate.getTime();
  // B3: UTC thực = asUTC - offset
  const realUTC = new Date(asUTC.getTime() - offsetMs);
  return realUTC.toISOString().replace("Z", "Z"); // sqlite compatible ISO
}

/* ----------------------------- HTML Cleaner ----------------------------- */
function cleanHtml(input) {
  const cfg = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img","iframe","table","thead","tbody","tr","th","td"
    ]),
    allowedAttributes: {
      a: ["href","name","target","rel"],
      img: ["src","alt","width","height"],
      iframe: ["src","width","height","frameborder","allow","referrerpolicy","allowfullscreen"],
      "*": ["style","class","align"]
    },
    allowedIframeHostnames: ["www.youtube.com","youtube.com","youtu.be"],
    transformTags: {
      iframe: function(tagName, attribs) {
        try {
          const url = new URL(attribs.src || "", "http://x");
          const host = url.hostname.replace(/^www\./, "");
          if (!["youtube.com","youtu.be"].includes(host) && host.indexOf("youtube.com") === -1) {
            return { tagName: "p", text: "" };
          }
        } catch(e) { return { tagName: "p", text: "" }; }
        attribs.referrerpolicy = "strict-origin-when-cross-origin";
        attribs.allow = attribs.allow || "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        return { tagName: "iframe", attribs };
      }
    }
  };
  return sanitizeHtml(input || "", cfg);
}

/* ----------------------------- Categories helper ----------------------------- */
async function fetchCategoriesFlat(db, lang) {
  // lấy hết categories + parent, sau đó flatten theo tree, có depth để thụt lề
  const rows = await db.all(`
    SELECT c.id, c.parent_id, c.order_index,
           ct.name
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY c.parent_id IS NOT NULL, c.parent_id, c.order_index, c.id
  `, [lang]);

  // build map
  const byParent = new Map();
  rows.forEach(r => {
    const k = r.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(r);
  });

  const out = [];
  (function walk(parentId, depth) {
    const list = byParent.get(parentId || 0) || [];
    for (const r of list) {
      out.push({ id: r.id, name: r.name || `(ID ${r.id})`, depth });
      walk(r.id, depth + 1);
    }
  })(0, 0);

  return out;
}

/* ----------------------------- Media helpers ----------------------------- */
async function getFeaturedOfPost(db, postId) {
  return db.get(`
    SELECT m.id, m.url
    FROM media_usages mu
    JOIN media m ON m.id = mu.media_id
    WHERE mu.post_id = ? AND mu.field = 'featured'
    LIMIT 1
  `, [postId]);
}
async function getGalleryOfPost(db, postId) {
  return db.all(`
    SELECT m.id, m.url
    FROM media_usages mu
    JOIN media m ON m.id = mu.media_id
    WHERE mu.post_id = ? AND mu.field = 'gallery'
    ORDER BY mu.position ASC
  `, [postId]);
}

/* ------------------------------- LIST PAGE ------------------------------- */
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const timeZone = await getSetting("timezone", "Asia/Ho_Chi_Minh");

  const allowedSort = new Set(["title", "status", "created_at", "scheduled_at"]);
  const sort = allowedSort.has(req.query.sort) ? req.query.sort : "created_at";
  const dir  = (req.query.dir === "asc" ? "asc" : "desc");
  const sortMap = {
    title: "t.title",
    status: "p.status",
    created_at: "p.created_at",
    scheduled_at: "p.scheduled_at",
  };
  const orderBy = sortMap[sort] || "p.created_at";

  const rows = await db.all(`
    SELECT
      p.id,
      p.status,
      p.created_at,
      p.scheduled_at,
      u.username AS author,
      t.title,
      t.slug,
      (
        SELECT GROUP_CONCAT(ct.name, ', ')
        FROM posts_categories pc
        JOIN categories_translations ct
          ON ct.category_id = pc.category_id AND ct.language = ?
        WHERE pc.post_id = p.id
      ) AS categories_text,
      (
        SELECT GROUP_CONCAT(tt.name, ', ')
        FROM posts_tags pt
        JOIN tags_translations tt
          ON tt.tag_id = pt.tag_id AND tt.language = ?
        WHERE pt.post_id = p.id
      ) AS tags_text
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id = p.id AND t.language = ?
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.deleted_at IS NULL
    ORDER BY ${orderBy} ${dir}
    LIMIT 500
  `, [lang, lang, lang]);

  const data = rows.map(r => ({
    ...r,
    created_at_fmt: formatUtcToTZ(r.created_at, timeZone),
    scheduled_at_fmt: r.scheduled_at ? formatUtcToTZ(r.scheduled_at, timeZone) : "",
  }));

  res.render("posts/list", {
    pageTitle: "Bài viết",
    rows: data,
    sort,
    dir,
  });
});

/* -------------------------------- NEW FORM ------------------------------- */
router.get("/new", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language","vi");
  const categories = await fetchCategoriesFlat(db, lang);
  res.render("posts/edit", {
    pageTitle: "Tạo bài viết",
    isNew: true,
    item: null,
    featured: null,
    gallery: [],
    categories,
    selectedCategoryIds: [],
    primaryCategoryId: "",
    error: null,
  });
});

/* ------------------------------- EDIT FORM ------------------------------- */
router.get("/:id/edit", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db   = await getDb();
  const id   = parseInt(req.params.id, 10);
  const lang = await getSetting("default_language","vi");

  const item = await db.get(`
    SELECT p.id, p.status, p.created_at, p.scheduled_at,
           t.title, t.slug, t.content_html
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id = p.id AND t.language = ?
    WHERE p.id = ? AND p.deleted_at IS NULL
  `, [lang, id]);
  if (!item) return res.status(404).send("Not found");

  const featured = await getFeaturedOfPost(db, id);
  const gallery  = await getGalleryOfPost(db, id);
  const categories = await fetchCategoriesFlat(db, lang);
  const selectedCategoryIds = (await db.all(
    "SELECT category_id AS id FROM posts_categories WHERE post_id=?",
    [id]
  )).map(r => String(r.id));
  const primaryRow = await db.get(
    "SELECT category_id AS id FROM posts_categories WHERE post_id=? AND is_primary=1 LIMIT 1",
    [id]
  );
  const primaryCategoryId = primaryRow ? String(primaryRow.id) : (selectedCategoryIds[0] || "");

  res.render("posts/edit", {
    pageTitle: "Sửa bài viết",
    isNew: false,
    item,
    featured,
    gallery,
    categories,
    selectedCategoryIds,
    primaryCategoryId,
    error: null,
  });
});

/* ----------------------------- VALIDATION HELPERS ----------------------------- */
function validateCategories(body) {
  // body.category_ids[] -> mảng id dạng string
  const ids = []
    .concat(body["category_ids[]"] || body.category_ids || [])
    .map(x => String(x))
    .filter(Boolean);

  let primary = String(body.primary_category_id || "");

  if (ids.length === 0) {
    return { ok: false, message: "Bạn chưa chọn danh mục, vui lòng chọn ít nhất 1 danh mục." };
  }
  // Nếu user chọn nhiều mà không chọn danh mục chính:
  if (ids.length > 1 && !primary) {
    // lấy danh mục chọn cuối cùng làm chính
    primary = ids[ids.length - 1];
  }
  // Nếu chỉ 1 danh mục và chưa set primary => lấy luôn danh mục đó
  if (ids.length === 1 && !primary) {
    primary = ids[0];
  }
  // Bảo đảm primary ∈ ids
  if (primary && !ids.includes(primary)) {
    ids.push(primary);
  }
  return { ok: true, ids, primary };
}

/* ------------------------------- SAVE NEW ------------------------------- */
router.post("/new", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language","vi");
  const timeZone = await getSetting("timezone","Asia/Ho_Chi_Minh");

  // validate danh mục
  const cat = validateCategories(req.body);
  if (!cat.ok) {
    const categories = await fetchCategoriesFlat(db, lang);
    return res.status(422).render("posts/edit", {
      pageTitle: "Tạo bài viết",
      isNew: true,
      item: {
        title: req.body.title || "",
        slug:  req.body.slug  || "",
        content_html: req.body.content_html || "",
        status: req.body.status || "draft",
      },
      featured: null,
      gallery: [],
      categories,
      selectedCategoryIds: [],
      primaryCategoryId: "",
      error: cat.message,
    });
  }

  // lịch đăng
  let scheduled_at = null;
  const status = req.body.status || "draft";
  if (status === "scheduled") {
    scheduled_at = parseLocalToUTC(req.body.scheduled_at_local || "", timeZone);
    if (!scheduled_at) {
      const categories = await fetchCategoriesFlat(db, lang);
      return res.status(422).render("posts/edit", {
        pageTitle: "Tạo bài viết",
        isNew: true,
        item: {
          title: req.body.title || "",
          slug:  req.body.slug  || "",
          content_html: req.body.content_html || "",
          status,
        },
        featured: null,
        gallery: [],
        categories,
        selectedCategoryIds: cat.ids,
        primaryCategoryId: cat.primary,
        error: "Bạn chọn trạng thái Lên lịch nhưng chưa chọn thời điểm hợp lệ.",
      });
    }
    // bắt buộc tương lai
    if (new Date(scheduled_at).getTime() <= Date.now()) {
      const categories = await fetchCategoriesFlat(db, lang);
      return res.status(422).render("posts/edit", {
        pageTitle: "Tạo bài viết",
        isNew: true,
        item: {
          title: req.body.title || "",
          slug:  req.body.slug  || "",
          content_html: req.body.content_html || "",
          status,
        },
        featured: null,
        gallery: [],
        categories,
        selectedCategoryIds: cat.ids,
        primaryCategoryId: cat.primary,
        error: "Thời điểm lên lịch phải ở tương lai.",
      });
    }
  }

  // insert
  const title = (req.body.title || "").trim();
  const theSlug = (req.body.slug && req.body.slug.trim()) ? toSlug(req.body.slug) : toSlug(title);
  const contentClean = cleanHtml(req.body.content_html || "");

  try {
    await db.run("BEGIN");
    await db.run(
      `INSERT INTO posts (status, created_by, updated_by, scheduled_at)
       VALUES (?,?,?,?)`,
      [status, req.user.id, req.user.id, scheduled_at]
    );
    const newIdRow = await db.get("SELECT last_insert_rowid() AS id");
    const postId = newIdRow.id;

    await db.run(
      `INSERT INTO posts_translations (post_id, language, title, slug, content_html)
       VALUES (?,?,?,?,?)`,
      [postId, lang, title, theSlug, contentClean]
    );

    // categories
    for (const cid of cat.ids) {
      const isPrimary = (cid === cat.primary) ? 1 : 0;
      await db.run(
        `INSERT INTO posts_categories (post_id, category_id, is_primary) VALUES (?,?,?)`,
        [postId, cid, isPrimary]
      );
    }

    // featured image via media_usages (field='featured')
    const featuredId = req.body.featured_media_id ? parseInt(req.body.featured_media_id, 10) : null;
    if (featuredId) {
      await db.run(
        `INSERT INTO media_usages (post_id, media_id, field, position)
         VALUES (?,?, 'featured', 0)`,
        [postId, featuredId]
      );
    }

    // gallery
    const galleryIds = []
      .concat(req.body["gallery_media_ids[]"] || req.body.gallery_media_ids || [])
      .map(x => parseInt(x, 10))
      .filter(x => !isNaN(x));
    for (let i = 0; i < galleryIds.length; i++) {
      await db.run(
        `INSERT INTO media_usages (post_id, media_id, field, position)
         VALUES (?,?, 'gallery', ?)`,
        [postId, galleryIds[i], i]
      );
    }

    await db.run("COMMIT");
    return res.redirect("/admin/posts");
  } catch (e) {
    await db.run("ROLLBACK");
    const categories = await fetchCategoriesFlat(db, lang);
    return res.status(500).render("posts/edit", {
      pageTitle: "Tạo bài viết",
      isNew: true,
      item: { title, slug: theSlug, content_html: req.body.content_html || "", status },
      featured: null,
      gallery: [],
      categories,
      selectedCategoryIds: cat.ids,
      primaryCategoryId: cat.primary,
      error: e.message || "Lỗi lưu bài viết.",
    });
  }
});

/* ------------------------------- SAVE EDIT ------------------------------- */
router.post("/:id/edit", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db   = await getDb();
  const id   = parseInt(req.params.id, 10);
  const lang = await getSetting("default_language","vi");
  const timeZone = await getSetting("timezone","Asia/Ho_Chi_Minh");

  const cat = validateCategories(req.body);
  if (!cat.ok) {
    // re-render với lỗi
    const item = {
      id,
      title: req.body.title || "",
      slug:  req.body.slug  || "",
      content_html: req.body.content_html || "",
      status: req.body.status || "draft",
    };
    const featured = await getFeaturedOfPost(db, id);
    const gallery  = await getGalleryOfPost(db, id);
    const categories = await fetchCategoriesFlat(db, lang);
    return res.status(422).render("posts/edit", {
      pageTitle: "Sửa bài viết",
      isNew: false,
      item,
      featured, gallery, categories,
      selectedCategoryIds: cat.ids,
      primaryCategoryId: cat.primary,
      error: cat.message
    });
  }

  const status = req.body.status || "draft";
  let scheduled_at = null;
  if (status === "scheduled") {
    scheduled_at = parseLocalToUTC(req.body.scheduled_at_local || "", timeZone);
    if (!scheduled_at || new Date(scheduled_at).getTime() <= Date.now()) {
      const item = {
        id,
        title: req.body.title || "",
        slug:  req.body.slug  || "",
        content_html: req.body.content_html || "",
        status,
      };
      const featured = await getFeaturedOfPost(db, id);
      const gallery  = await getGalleryOfPost(db, id);
      const categories = await fetchCategoriesFlat(db, lang);
      return res.status(422).render("posts/edit", {
        pageTitle: "Sửa bài viết",
        isNew: false,
        item, featured, gallery, categories,
        selectedCategoryIds: cat.ids,
        primaryCategoryId: cat.primary,
        error: "Thời điểm lên lịch không hợp lệ hoặc không phải tương lai."
      });
    }
  }

  const title = (req.body.title || "").trim();
  const theSlug = (req.body.slug && req.body.slug.trim()) ? toSlug(req.body.slug) : toSlug(title);
  const contentClean = cleanHtml(req.body.content_html || "");
  const featuredId = req.body.featured_media_id ? parseInt(req.body.featured_media_id, 10) : null;
  const galleryIds = []
    .concat(req.body["gallery_media_ids[]"] || req.body.gallery_media_ids || [])
    .map(x => parseInt(x, 10))
    .filter(x => !isNaN(x));

  try {
    await db.run("BEGIN");

    await db.run(
      `UPDATE posts SET status=?, scheduled_at=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [status, scheduled_at, req.user.id, id]
    );

    const exists = await db.get(
      `SELECT 1 FROM posts_translations WHERE post_id=? AND language=? LIMIT 1`,
      [id, lang]
    );
    if (exists) {
      await db.run(
        `UPDATE posts_translations SET title=?, slug=?, content_html=? WHERE post_id=? AND language=?`,
        [title, theSlug, contentClean, id, lang]
      );
    } else {
      await db.run(
        `INSERT INTO posts_translations (post_id, language, title, slug, content_html) VALUES (?,?,?,?,?)`,
        [id, lang, title, theSlug, contentClean]
      );
    }

    // categories: xoá cũ -> ghi mới
    await db.run(`DELETE FROM posts_categories WHERE post_id=?`, [id]);
    for (const cid of cat.ids) {
      const isPrimary = (cid === cat.primary) ? 1 : 0;
      await db.run(`INSERT INTO posts_categories (post_id, category_id, is_primary) VALUES (?,?,?)`,
        [id, cid, isPrimary]);
    }

    // featured: xoá cũ -> ghi mới (nếu có)
    await db.run(`DELETE FROM media_usages WHERE post_id=? AND field='featured'`, [id]);
    if (featuredId) {
      await db.run(
        `INSERT INTO media_usages (post_id, media_id, field, position)
         VALUES (?,?,'featured',0)`,
        [id, featuredId]
      );
    }

    // gallery: xoá cũ -> ghi mới
    await db.run(`DELETE FROM media_usages WHERE post_id=? AND field='gallery'`, [id]);
    for (let i = 0; i < galleryIds.length; i++) {
      await db.run(
        `INSERT INTO media_usages (post_id, media_id, field, position)
         VALUES (?,?, 'gallery', ?)`,
        [id, galleryIds[i], i]
      );
    }

    await db.run("COMMIT");
    return res.redirect("/admin/posts");
  } catch (e) {
    await db.run("ROLLBACK");
    const item = {
      id, title, slug: theSlug, content_html: req.body.content_html || "", status
    };
    const featured = await getFeaturedOfPost(db, id);
    const gallery  = await getGalleryOfPost(db, id);
    const categories = await fetchCategoriesFlat(db, lang);
    return res.status(500).render("posts/edit", {
      pageTitle: "Sửa bài viết",
      isNew: false,
      item, featured, gallery, categories,
      selectedCategoryIds: cat.ids,
      primaryCategoryId: cat.primary,
      error: e.message || "Lỗi lưu bài viết.",
    });
  }
});

export default router;
