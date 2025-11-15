import express from "express";
import sanitizeHtml from "sanitize-html";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";
import { formatUtcToTZ, localToUtcSql } from "../utils/time.js";
import { getSeo, getSeoDefaults } from "../services/seo.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

/* ------------------------ Helpers ------------------------ */
function cleanHtml(input) {
  const cfg = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img","iframe","table","thead","tbody","tr","th","td",
    ]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      iframe: [
        "src","width","height","frameborder","allow","referrerpolicy","allowfullscreen",
      ],
      "*": ["style", "class", "align"],
    },
    allowedIframeHostnames: ["www.youtube.com", "youtube.com", "youtu.be"],
    transformTags: {
      iframe: function (tagName, attribs) {
        try {
          const url = new URL(attribs.src || "", "http://x");
          const host = url.hostname.replace(/^www\./, "");
          if (!["youtube.com", "youtu.be"].includes(host) && host.indexOf("youtube.com") === -1) {
            return { tagName: "p", text: "" };
          }
        } catch (e) { return { tagName: "p", text: "" }; }
        attribs.referrerpolicy = "strict-origin-when-cross-origin";
        attribs.allow = attribs.allow || "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        return { tagName: "iframe", attribs };
      },
    },
  };
  return sanitizeHtml(input || "", cfg);
}
const coerceArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
function buildGalleryFromBody(body) {
  const raw = body["gallery_urls[]"] ?? (Array.isArray(body.gallery_urls) ? body.gallery_urls : body.gallery_urls);
  const urls = coerceArray(raw).filter(Boolean);
  return urls.map((u) => ({ id: null, url: u }));
}
function extractSeoFromBody(body) {
  return {
    title: body.seo_title || "",
    description: body.seo_description || "",
    focus_keyword: body.seo_focus_keyword || "",
    robots_index: body.seo_robots_index || "",
    robots_follow: body.seo_robots_follow || "",
    robots_advanced: body.seo_robots_advanced || "",
    canonical_url: body.seo_canonical_url || "",
    schema_type: body.seo_schema_type || "",
    schema_jsonld: body.seo_schema_jsonld || "",
    og_title: body.seo_og_title || "",
    og_description: body.seo_og_description || "",
    og_image_url: body.seo_og_image_url || "",
    twitter_title: body.seo_twitter_title || "",
    twitter_description: body.seo_twitter_description || "",
    twitter_image_url: body.seo_twitter_image_url || "",
  };
}

async function getCategoriesIndented(db, lang) {
  const rows = await db.all(
    `SELECT c.id, c.parent_id, c.order_index, COALESCE(ct.name,'') AS name
       FROM categories c
  LEFT JOIN categories_translations ct ON ct.category_id = c.id AND ct.language = ?
      WHERE c.deleted_at IS NULL
   ORDER BY COALESCE(c.parent_id,0), c.order_index, c.id`, [lang]
  );
  const byParent = new Map();
  rows.forEach(r => { const k = r.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(r); });
  const out = [];
  (function dfs(pid, depth){
    (byParent.get(pid || 0) || []).forEach(r => {
      out.push({ id: r.id, name: r.name, indented_name: `${"— ".repeat(depth)}${r.name || "(Không tên)"}` });
      dfs(r.id, depth + 1);
    });
  })(0,0);
  return out;
}

async function getPostRow(db, id, lang) {
  const item = await db.get(
    `SELECT p.*, t.title, t.slug, t.content_html,
            (SELECT m.url FROM media_usages mu JOIN media m ON m.id=mu.media_id
              WHERE mu.post_id=p.id AND mu.field='featured' ORDER BY mu.position LIMIT 1) AS featured_url
       FROM posts p
  LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
      WHERE p.id=? AND p.deleted_at IS NULL`, [lang, id]
  );
  if (!item) return null;
  const cats = await db.all(`SELECT category_id, is_primary FROM posts_categories WHERE post_id=?`, [id]);
  const selectedIds = cats.map(x => String(x.category_id));
  const primaryCat = cats.find(x => x.is_primary === 1)?.category_id || selectedIds[0] || "";
  let gallery = [];
  try {
    gallery = await db.all(
      `SELECT m.id, m.url
         FROM media_usages mu JOIN media m ON m.id = mu.media_id
        WHERE mu.post_id = ? AND mu.field = 'gallery'
        ORDER BY mu.position`, [id]
    );
  } catch {}
  return { item, selectedIds, primaryCat, gallery };
}

async function upsertFeaturedByUrl(db, postId, url) {
  if (!url) return;
  const media = await db.get(`SELECT id FROM media WHERE url=? LIMIT 1`, [url]);
  if (!media) return;
  await db.run(`DELETE FROM media_usages WHERE post_id=? AND field='featured'`, [postId]);
  await db.run(`INSERT INTO media_usages(post_id, media_id, field, position) VALUES(?, ?, 'featured', 0)`, [postId, media.id]);
}
async function replaceGalleryByUrls(db, postId, urls=[]) {
  await db.run(`DELETE FROM media_usages WHERE post_id=? AND field='gallery'`, [postId]);
  for (let i=0;i<urls.length;i++){
    const media = await db.get(`SELECT id FROM media WHERE url=? LIMIT 1`, [urls[i]]);
    if (media) await db.run(`INSERT INTO media_usages(post_id, media_id, field, position) VALUES(?, ?, 'gallery', ?)`, [postId, media.id, i]);
  }
}

/* ------------------------ Activity Log helpers ------------------------ */
async function shouldLog(req) {
  try {
    if (req?.query?.nolog === "1" || req?.body?.nolog === "1") return false;
    const enabled = await getSetting("activity.logs.enabled", "1");
    return String(enabled) === "1";
  } catch { return true; }
}
async function tryLog(req, action, entity, entityId, meta=null) {
  try { if (await shouldLog(req)) await logActivity(req.user?.id || null, action, entity, entityId, meta); }
  catch { /* ignore */ }
}

/* ------------------------ LIST ------------------------ */
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const timeZone = await getSetting("timezone", "Asia/Ho_Chi_Minh");

  const allowedSort = new Set(["title","status","created_at","scheduled_at"]);
  const sort = allowedSort.has(req.query.sort) ? req.query.sort : "created_at";
  const dir  = req.query.dir === "asc" ? "asc" : "desc";
  const sortMap = { title:"t.title", status:"p.status", created_at:"p.created_at", scheduled_at:"p.scheduled_at" };
  const orderBy = sortMap[sort] || "p.created_at";

  const rows = await db.all(
    `SELECT p.id, p.status, p.created_by, p.created_at, p.scheduled_at,
            u.username AS author, t.title, t.slug,
            (SELECT m.url FROM media_usages mu JOIN media m ON m.id=mu.media_id
              WHERE mu.post_id=p.id AND mu.field='featured' ORDER BY mu.position LIMIT 1) AS featured_url,
            (SELECT GROUP_CONCAT(ct.name SEPARATOR ', ')
               FROM posts_categories pc JOIN categories_translations ct
                 ON ct.category_id=pc.category_id AND ct.language=?
              WHERE pc.post_id=p.id) AS categories_text,
            (SELECT GROUP_CONCAT(tt.name SEPARATOR ', ')
               FROM posts_tags pt JOIN tags_translations tt
                 ON tt.tag_id=pt.tag_id AND tt.language=?
              WHERE pt.post_id=p.id) AS tags_text
       FROM posts p
  LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
  LEFT JOIN users u ON u.id=p.created_by
      WHERE p.deleted_at IS NULL
   ORDER BY ${orderBy} ${dir}
      LIMIT 500`, [lang, lang, lang]
  );

  const data = rows.map(r => ({
    ...r,
    created_at_fmt: formatUtcToTZ(r.created_at, timeZone),
    scheduled_at_fmt: r.status === "scheduled" && r.scheduled_at ? formatUtcToTZ(r.scheduled_at, timeZone) : "—",
  }));

  res.render("posts/list", {
    pageTitle: "Bài viết",
    rows: data,
    sort, dir,
    ok: req.query.ok || "",
    err: req.query.err || "",
  });
});

/* ------------------------ NEW ------------------------ */
router.get("/new", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const tz = await getSetting("timezone", "Asia/Ho_Chi_Minh");

  const categories = await getCategoriesIndented(db, lang);

  const now = new Date();
  const nowUtcSql = `${now.toISOString().slice(0,19).replace("T"," ")}`;
  const nowLocal  = formatUtcToTZ(nowUtcSql, tz, "yyyy-MM-dd HH:mm").replace(" ","T");

  let seoDefaults = {};
  try { seoDefaults = (await getSeoDefaults("post")) || {}; } catch { seoDefaults = {}; }

  res.render("posts/edit", {
    pageTitle: "Tạo bài viết",
    mode: "create",
    item: null,
    categories,
    selectedCategoryIds: [],
    primaryCategoryId: "",
    gallery: [],
    created_at_local: nowLocal,
    scheduled_at_local: "",
    error: null,
    seo: {},
    seoDefaults,
  });
});

router.post("/new", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const tz = await getSetting("timezone", "Asia/Ho_Chi_Minh");

  let seoDefaults = {};
  try { seoDefaults = (await getSeoDefaults("post")) || {}; } catch { seoDefaults = {}; }

  try {
    const { title, slug, status, content_html, created_at_local, scheduled_at_local, featured_url } = req.body;

    let category_ids = req.body["category_ids[]"] || req.body.category_ids || [];
    if (!Array.isArray(category_ids)) category_ids = [category_ids].filter(Boolean);

    let primary_category_id = req.body.primary_category_id ||
      (category_ids.length ? String(category_ids[category_ids.length - 1]) : "");

    if (category_ids.length === 0) {
      const categories = await getCategoriesIndented(db, lang);
      return res.status(400).render("posts/edit", {
        pageTitle: "Tạo bài viết",
        mode: "create",
        item: { title, slug, status, content_html, featured_url: featured_url || "" },
        categories,
        selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
        primaryCategoryId: req.body.primary_category_id || "",
        gallery: buildGalleryFromBody(req.body),
        created_at_local: created_at_local || "",
        scheduled_at_local: scheduled_at_local || "",
        error: "Bạn chưa chọn danh mục, vui lòng chọn.",
        seo: extractSeoFromBody(req.body),
        seoDefaults,
      });
    }

    if (category_ids.length > 1 && !primary_category_id) {
      primary_category_id = String(category_ids[category_ids.length - 1]);
    }

    const theSlug   = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    const createdUtc = localToUtcSql(created_at_local, tz) || null;

    let scheduledUtc = null;
    if (status === "scheduled") {
      if (!scheduled_at_local) {
        const categories = await getCategoriesIndented(db, lang);
        return res.status(400).render("posts/edit", {
          pageTitle: "Tạo bài viết",
          mode: "create",
          item: { title, slug, status, content_html, featured_url: featured_url || "" },
          categories,
          selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
          primaryCategoryId: req.body.primary_category_id || "",
          gallery: buildGalleryFromBody(req.body),
          created_at_local: created_at_local || "",
          scheduled_at_local: scheduled_at_local || "",
          error: "Vui lòng chọn thời điểm lên lịch đăng (trong tương lai).",
          seo: extractSeoFromBody(req.body),
          seoDefaults,
        });
      }
      scheduledUtc = localToUtcSql(scheduled_at_local, tz);
      const nowUtc = new Date().toISOString().slice(0,19).replace("T"," ");
      if (scheduledUtc <= nowUtc) {
        const categories = await getCategoriesIndented(db, lang);
        return res.status(400).render("posts/edit", {
          pageTitle: "Tạo bài viết",
          mode: "create",
          item: { title, slug, status, content_html, featured_url: featured_url || "" },
          categories,
          selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
          primaryCategoryId: req.body.primary_category_id || "",
          gallery: buildGalleryFromBody(req.body),
          created_at_local: created_at_local || "",
          scheduled_at_local: scheduled_at_local || "",
          error: "Thời điểm lên lịch phải ở tương lai.",
          seo: extractSeoFromBody(req.body),
          seoDefaults,
        });
      }
    }

    const ins = await db.run(
      `INSERT INTO posts(status, created_by, updated_by, created_at, updated_at, scheduled_at, deleted_at)
       VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP, ?, NULL)`,
      [status || "draft", req.user.id, req.user.id, createdUtc, scheduledUtc]
    );
    const postId = ins?.insertId || (await db.get(`SELECT LAST_INSERT_ID() AS id`))?.id;

    await db.run(
      `INSERT INTO posts_translations(post_id, language, title, slug, content_html)
       VALUES(?,?,?,?,?)`,
      [postId, lang, title || "", theSlug || "", cleanHtml(content_html || "")]
    );

    await db.run(`DELETE FROM posts_categories WHERE post_id=?`, [postId]);
    for (const cid of category_ids) {
      const isPrimary = String(cid) === String(primary_category_id) ? 1 : 0;
      await db.run(`INSERT INTO posts_categories(post_id, category_id, is_primary) VALUES(?, ?, ?)`, [postId, cid, isPrimary]);
    }

    if (featured_url) await upsertFeaturedByUrl(db, postId, featured_url);
    const galleryObjs = buildGalleryFromBody(req.body);
    await replaceGalleryByUrls(db, postId, galleryObjs.map(g => g.url));

    await tryLog(req, "create", "post", postId);

    res.redirect("/admin/posts?ok=created");
  } catch (e) {
    const db2 = await getDb();
    const categories = await getCategoriesIndented(db2, lang);
    res.status(400).render("posts/edit", {
      pageTitle: "Tạo bài viết",
      mode: "create",
      item: {
        title: req.body.title || "",
        slug: req.body.slug || "",
        status: req.body.status || "draft",
        content_html: req.body.content_html || "",
        featured_url: req.body.featured_url || "",
      },
      categories,
      selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
      primaryCategoryId: req.body.primary_category_id || "",
      gallery: buildGalleryFromBody(req.body),
      created_at_local: req.body.created_at_local || "",
      scheduled_at_local: req.body.scheduled_at_local || "",
      error: e.message || String(e),
      seo: extractSeoFromBody(req.body),
      seoDefaults,
    });
  }
});

/* ------------------------ EDIT ------------------------ */
router.get("/:id/edit", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const tz = await getSetting("timezone", "Asia/Ho_Chi_Minh");
  const id = parseInt(req.params.id, 10);

  const categories = await getCategoriesIndented(db, lang);
  const info = await getPostRow(db, id, lang);
  if (!info) return res.status(404).send("Không tìm thấy bài viết");

  const { item, selectedIds, primaryCat, gallery } = info;
  const createdLocal = formatUtcToTZ(item.created_at, tz, "yyyy-MM-dd HH:mm").replace(" ","T");
  const scheduledLocal = item.scheduled_at ? formatUtcToTZ(item.scheduled_at, tz, "yyyy-MM-dd HH:mm").replace(" ","T") : "";

  let seo = {}; let seoDefaults = {};
  try { seo = (await getSeo("post", id)) || {}; } catch {}
  try { seoDefaults = (await getSeoDefaults("post")) || {}; } catch { seoDefaults = {}; }

  res.render("posts/edit", {
    pageTitle: "Sửa bài viết",
    mode: "edit",
    item,
    categories,
    selectedCategoryIds: selectedIds,
    primaryCategoryId: String(primaryCat || ""),
    gallery,
    created_at_local: createdLocal,
    scheduled_at_local: scheduledLocal,
    error: null,
    seo, seoDefaults,
  });
});

router.post("/:id/edit", requireRoles("admin","editor","author","contributor"), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");
  const tz = await getSetting("timezone", "Asia/Ho_Chi_Minh");
  const id = parseInt(req.params.id, 10);

  let seoDefaults = {};
  try { seoDefaults = (await getSeoDefaults("post")) || {}; } catch { seoDefaults = {}; }

  try {
    const { title, slug, status, content_html, created_at_local, scheduled_at_local, featured_url } = req.body;

    let category_ids = req.body["category_ids[]"] || req.body.category_ids || [];
    if (!Array.isArray(category_ids)) category_ids = [category_ids].filter(Boolean);
    let primary_category_id = req.body.primary_category_id ||
      (category_ids.length ? String(category_ids[category_ids.length - 1]) : "");

    if (category_ids.length === 0) {
      const categories = await getCategoriesIndented(db, lang);
      return res.status(400).render("posts/edit", {
        pageTitle: "Sửa bài viết",
        mode: "edit",
        item: { id, title, slug, status, content_html, featured_url: featured_url || "" },
        categories,
        selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
        primaryCategoryId: req.body.primary_category_id || "",
        gallery: buildGalleryFromBody(req.body),
        created_at_local: created_at_local || "",
        scheduled_at_local: scheduled_at_local || "",
        error: "Bạn chưa chọn danh mục, vui lòng chọn.",
        seo: extractSeoFromBody(req.body),
        seoDefaults,
      });
    }

    if (category_ids.length > 1 && !primary_category_id) {
      primary_category_id = String(category_ids[category_ids.length - 1]);
    }

    const theSlug   = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    const createdUtc = localToUtcSql(created_at_local, tz) || null;

    let scheduledUtc = null;
    if (status === "scheduled") {
      if (!scheduled_at_local) {
        const categories = await getCategoriesIndented(db, lang);
        return res.status(400).render("posts/edit", {
          pageTitle: "Sửa bài viết",
          mode: "edit",
          item: { id, title, slug, status, content_html, featured_url: featured_url || "" },
          categories,
          selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
          primaryCategoryId: req.body.primary_category_id || "",
          gallery: buildGalleryFromBody(req.body),
          created_at_local: created_at_local || "",
          scheduled_at_local: scheduled_at_local || "",
          error: "Vui lòng chọn thời điểm lên lịch đăng (trong tương lai).",
          seo: extractSeoFromBody(req.body),
          seoDefaults,
        });
      }
      scheduledUtc = localToUtcSql(scheduled_at_local, tz);
      const nowUtc = new Date().toISOString().slice(0,19).replace("T"," ");
      if (scheduledUtc <= nowUtc) {
        const categories = await getCategoriesIndented(db, lang);
        return res.status(400).render("posts/edit", {
          pageTitle: "Sửa bài viết",
          mode: "edit",
          item: { id, title, slug, status, content_html, featured_url: featured_url || "" },
          categories,
          selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
          primaryCategoryId: req.body.primary_category_id || "",
          gallery: buildGalleryFromBody(req.body),
          created_at_local: created_at_local || "",
          scheduled_at_local: scheduled_at_local || "",
          error: "Thời điểm lên lịch phải ở tương lai.",
          seo: extractSeoFromBody(req.body),
          seoDefaults,
        });
      }
    }

    await db.run(
      `UPDATE posts
          SET status = ?,
              updated_by = ?,
              updated_at = CURRENT_TIMESTAMP,
              created_at = ?,
              scheduled_at = ?
        WHERE id = ?`,
      [status || "draft", req.user.id, createdUtc, scheduledUtc, id]
    );

    await db.run(
      `UPDATE posts_translations
          SET title = ?, slug = ?, content_html = ?
        WHERE post_id = ? AND language = ?`,
      [title || "", theSlug || "", cleanHtml(content_html || ""), id, lang]
    );

    await db.run(`DELETE FROM posts_categories WHERE post_id = ?`, [id]);
    for (const cid of category_ids) {
      const isPrimary = String(cid) === String(primary_category_id) ? 1 : 0;
      await db.run(`INSERT INTO posts_categories(post_id, category_id, is_primary) VALUES(?, ?, ?)`, [id, cid, isPrimary]);
    }

    await upsertFeaturedByUrl(db, id, featured_url);
    const galleryObjs = buildGalleryFromBody(req.body);
    await replaceGalleryByUrls(db, id, galleryObjs.map(g => g.url));

    await tryLog(req, "update", "post", id);

    res.redirect("/admin/posts?ok=updated");
  } catch (e) {
    const db2 = await getDb();
    const categories = await getCategoriesIndented(db2, lang);
    res.status(400).render("posts/edit", {
      pageTitle: "Sửa bài viết",
      mode: "edit",
      item: {
        id,
        title: req.body.title || "",
        slug: req.body.slug || "",
        status: req.body.status || "draft",
        content_html: req.body.content_html || "",
        featured_url: req.body.featured_url || "",
      },
      categories,
      selectedCategoryIds: (req.body["category_ids[]"] || req.body.category_ids || []).map(String).filter(Boolean),
      primaryCategoryId: req.body.primary_category_id || "",
      gallery: buildGalleryFromBody(req.body),
      created_at_local: req.body.created_at_local || "",
      scheduled_at_local: req.body.scheduled_at_local || "",
      error: e.message || String(e),
      seo: extractSeoFromBody(req.body),
      seoDefaults,
    });
  }
});

/* ------------------------ TRASH / RESTORE ------------------------ */
router.post("/:id/trash", requireRoles("admin","editor"), async (req, res) => {
  const db = await getDb();
  const id = parseInt(req.params.id, 10);

  try {
    const row = await db.get(`SELECT id, deleted_at FROM posts WHERE id=?`, [id]);
    if (!row) return res.redirect("/admin/posts?err=not_found");
    if (row.deleted_at) return res.redirect("/admin/posts?ok=already_trashed");

    await db.run(`UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id=?`, [id]);
    try { await logActivity(req.user?.id, "trash", "post", id, null, req); } catch {}
    return res.redirect("/admin/posts?ok=trashed");
  } catch (e) {
    return res.redirect("/admin/posts?err=" + encodeURIComponent(e.message || "trash_failed"));
  }
});

router.post("/:id/restore", requireRoles("admin"), async (req, res) => {
  const db = await getDb(); const id = parseInt(req.params.id, 10);
  try {
    const row = await db.get(`SELECT id FROM posts WHERE id=? AND deleted_at IS NOT NULL`, [id]);
    if (!row) return res.redirect("/admin/trash?err=not_in_trash");
    await db.run(`UPDATE posts SET deleted_at=NULL WHERE id=?`, [id]);
    try { await logActivity(req.user?.id, "restore", "post", id, null, req); } catch {}
    return res.redirect("/admin/trash?ok=restored");
  } catch (e) {
    return res.redirect("/admin/trash?err=" + encodeURIComponent(e.message || "restore_failed"));
  }
});

export default router;
