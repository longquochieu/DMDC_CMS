import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";
import sanitizeHtml from "sanitize-html";
import { formatInTimeZone } from "date-fns-tz";
import { parseISO } from "date-fns";

const router = express.Router();

// ---- helpers ----
function formatUtcToTZ(utcString, tz){
  if (!utcString) return "";
  // DB lưu UTC dạng 'YYYY-MM-DD HH:mm:ss'
  const iso = utcString.replace(" ", "T") + "Z";
  try { return formatInTimeZone(new Date(iso), tz || "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"); }
  catch { return utcString; }
}

function cleanHtml(input){
  const cfg = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','iframe','table','thead','tbody','tr','th','td']),
    allowedAttributes: {
      a: ['href','name','target','rel'],
      img: ['src','alt','width','height'],
      iframe: ['src','width','height','frameborder','allow','referrerpolicy','allowfullscreen'],
      '*': ['style','class','align']
    },
    allowedIframeHostnames: ['www.youtube.com','youtube.com','youtu.be'],
    transformTags: {
      iframe: function(tagName, attribs){
        try{
          const url = new URL(attribs.src||'', 'http://x');
          const host = url.hostname.replace(/^www\./,'');
          if (!['youtube.com','youtu.be'].includes(host) && host.indexOf('youtube.com')===-1) {
            return { tagName:'p', text:'' };
          }
        }catch(e){ return { tagName:'p', text:'' }; }
        attribs.referrerpolicy = 'strict-origin-when-cross-origin';
        attribs.allow = attribs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        return { tagName:'iframe', attribs };
      }
    }
  };
  return sanitizeHtml(input||'', cfg);
}

// Lấy danh mục dạng phẳng + depth để render indent
async function getCategoriesFlat(db, lang){
  const rows = await db.all(`
    SELECT c.id, c.parent_id, COALESCE(ct.name, '—') AS name
    FROM categories c
    LEFT JOIN categories_translations ct
      ON ct.category_id = c.id AND ct.language = ?
    WHERE c.deleted_at IS NULL
    ORDER BY COALESCE(c.parent_id,0), c.order_index, c.id
  `, [lang]);

  const children = new Map();
  rows.forEach(r => {
    if (!children.has(r.parent_id||0)) children.set(r.parent_id||0, []);
    children.get(r.parent_id||0).push(r);
  });

  const out = [];
  (function dfs(pid, depth){
    const arr = children.get(pid) || [];
    for (const r of arr){
      out.push({ id: String(r.id), name: r.name, parent_id: r.parent_id, depth });
      dfs(r.id, depth+1);
    }
  })(0, 0);

  return out;
}

// ===== LIST =====
router.get("/", requireAuth, async (req,res) => {
  const db = await getDb();
  const lang = await getSetting("default_language","vi");
  const timeZone = await getSetting("timezone","Asia/Ho_Chi_Minh");

  const allowedSort = new Set(["title","status","created_at","scheduled_at"]);
  const sort = allowedSort.has(req.query.sort) ? req.query.sort : "created_at";
  const dir  = (req.query.dir === "asc" ? "asc" : "desc");

  const col = {
    title:       "t.title",
    status:      "p.status",
    created_at:  "p.created_at",
    scheduled_at:"p.scheduled_at"
  }[sort] || "p.created_at";

  const rows = await db.all(`
    SELECT
      p.id, p.status, p.created_by, p.created_at, p.scheduled_at,
      u.username AS author,
      t.title, t.slug,
      (SELECT GROUP_CONCAT(ct.name, ', ')
       FROM posts_categories pc
       JOIN categories_translations ct
         ON ct.category_id = pc.category_id AND ct.language = ?
       WHERE pc.post_id = p.id) AS categories_text,
      (SELECT GROUP_CONCAT(tt.name, ', ')
       FROM posts_tags pt
       JOIN tags_translations tt
         ON tt.tag_id = pt.tag_id AND tt.language = ?
       WHERE pt.post_id = p.id) AS tags_text
    FROM posts p
    LEFT JOIN posts_translations t
      ON t.post_id = p.id AND t.language = ?
    LEFT JOIN users u
      ON u.id = p.created_by
    WHERE p.deleted_at IS NULL
    ORDER BY ${col} ${dir}
    LIMIT 500
  `, [lang, lang, lang]);

  const data = rows.map(r => ({
    ...r,
    created_at_fmt: formatUtcToTZ(r.created_at, timeZone),
    scheduled_at_fmt: r.scheduled_at ? formatUtcToTZ(r.scheduled_at, timeZone) : ""
  }));

  res.render("posts/list", {
    pageTitle: "Bài viết",
    rows: data, sort, dir
  });
});

// ===== NEW =====
router.get("/new", requireRoles("admin","editor","author","contributor"), async (req,res) => {
  const db = await getDb();
  const lang = await getSetting("default_language","vi");
  const categories = await getCategoriesFlat(db, lang);

  res.render("posts/edit", {
    pageTitle: "Thêm bài viết",
    item: null,
    categories,
    selectedCategoryIds: [],
    primaryCategoryId: "",
    tags: [],
    // Lên lịch: mặc định rỗng ở form
    scheduled_at_local: "",
    created_at_local: ""
  });
});

router.post("/new", requireRoles("admin","editor","author","contributor"), async (req,res) => {
  const db = await getDb();
  const lang = await getSetting("default_language","vi");
  const tz = await getSetting("timezone","Asia/Ho_Chi_Minh");

  try{
    const {
      title, slug, status,
      content_html,
      selected_categories = [], primary_category_id = "",
      scheduled_at_local // chuỗi "DD/MM/YYYY HH:mm"
    } = req.body;

    // slug tự sinh
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    const now = new Date();
    // Convert lịch (local timezone) → UTC
    let scheduledUTC = null;
    if (status === "scheduled" && scheduled_at_local){
      // expect "dd/MM/yyyy HH:mm"
      const [d,m,yhhmm] = scheduled_at_local.split("/");
      const [y, rest] = [yhhmm.split(" ")[0], yhhmm.split(" ")[1]];
      const [hh,mm] = (rest||"00:00").split(":");
      const localISO = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}T${(hh||"00").padStart(2,"0")}:${(mm||"00").padStart(2,"0")}:00`;
      // parse theo tz → UTC
      const dt = new Date(localISO); // chấp nhận đơn giản (nếu cần chính xác tuyệt đối, dùng date-fns-tz zonedTimeToUtc)
      scheduledUTC = new Date(dt.getTime() - (dt.getTimezoneOffset()*60000)).toISOString().replace("T"," ").slice(0,19);
    }

    await db.run(
      `INSERT INTO posts(status, created_by, updated_by, created_at, updated_at, scheduled_at)
       VALUES(?,?,?,?,datetime("now"),?)`,
      status || "draft", req.user.id, req.user.id, /*created_at*/ new Date().toISOString().replace("T"," ").slice(0,19), scheduledUTC
    );

    const { id } = await db.get(`SELECT last_insert_rowid() AS id`);
    await db.run(
      `INSERT INTO posts_translations(post_id, language, title, slug, content_html)
       VALUES(?,?,?,?,?)`,
      id, lang, title, theSlug, cleanHtml(content_html||"")
    );

    // categories
    const catIds = Array.isArray(selected_categories) ? selected_categories : [selected_categories].filter(Boolean);
    for (let i=0;i<catIds.length;i++){
      await db.run(`INSERT INTO posts_categories(post_id, category_id, is_primary) VALUES(?,?,?)`,
        id, catIds[i], String(catIds[i]) === String(primary_category_id) ? 1 : 0);
    }
    // auto chọn primary nếu chưa chọn
    if (catIds.length && !primary_category_id){
      await db.run(`UPDATE posts_categories SET is_primary=1 WHERE post_id=? AND category_id=?`,
        id, catIds[catIds.length-1]); // danh mục chọn gần nhất
    }

    return res.redirect("/admin/posts");
  }catch(e){
    const categories = await getCategoriesFlat(db, lang);
    return res.status(400).render("posts/edit", {
      pageTitle: "Thêm bài viết",
      item: null,
      categories,
      selectedCategoryIds: req.body.selected_categories || [],
      primaryCategoryId: req.body.primary_category_id || "",
      tags: [],
      scheduled_at_local: req.body.scheduled_at_local || "",
      created_at_local: "",
      error: e.message
    });
  }
});

// ===== EDIT =====
router.get("/:id/edit", requireRoles("admin","editor","author","contributor"), async (req,res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting("default_language","vi");
  const timeZone = await getSetting("timezone","Asia/Ho_Chi_Minh");

  const item = await db.get(`
    SELECT p.*, t.title, t.slug, t.content_html
    FROM posts p
    LEFT JOIN posts_translations t
      ON t.post_id = p.id AND t.language=?
    WHERE p.id = ? AND p.deleted_at IS NULL
  `, [lang, id]);

  if (!item) return res.sendStatus(404);

  const categories = await getCategoriesFlat(db, lang);
  const catRows = await db.all(`SELECT category_id, is_primary FROM posts_categories WHERE post_id=?`, [id]);
  const selectedCategoryIds = catRows.map(r => String(r.category_id));
  const primaryRow = catRows.find(r => r.is_primary==1);
  const primaryCategoryId = primaryRow ? String(primaryRow.category_id) : "";

  res.render("posts/edit", {
    pageTitle: "Sửa bài viết",
    item,
    categories,
    selectedCategoryIds,
    primaryCategoryId,
    tags: [],
    scheduled_at_local: item.scheduled_at ? formatUtcToTZ(item.scheduled_at, timeZone) : "",
    created_at_local: item.created_at ? formatUtcToTZ(item.created_at, timeZone) : ""
  });
});

router.post("/:id/edit", requireRoles("admin","editor","author","contributor"), async (req,res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting("default_language","vi");

  try{
    const {
      title, slug, status, content_html,
      selected_categories = [], primary_category_id = "",
      scheduled_at_local
    } = req.body;

    // slug
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    // lịch → UTC (đơn giản)
    let scheduledUTC = null;
    if (status === "scheduled" && scheduled_at_local){
      const [d,m,yhhmm] = scheduled_at_local.split("/");
      const [y, rest] = [yhhmm.split(" ")[0], yhhmm.split(" ")[1]];
      const [hh,mm] = (rest||"00:00").split(":");
      const localISO = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}T${(hh||"00").padStart(2,"0")}:${(mm||"00").padStart(2,"0")}:00`;
      const dt = new Date(localISO);
      scheduledUTC = new Date(dt.getTime() - (dt.getTimezoneOffset()*60000)).toISOString().replace("T"," ").slice(0,19);
    }

    await db.run(
      `UPDATE posts
       SET status=?, updated_by=?, updated_at=datetime("now"), scheduled_at=?
       WHERE id=?`,
      status || "draft", req.user.id, scheduledUTC, id
    );

    await db.run(
      `UPDATE posts_translations
       SET title=?, slug=?, content_html=?
       WHERE post_id=? AND language=?`,
      title, theSlug, cleanHtml(content_html||""), id, lang
    );

    // Cập nhật categories
    await db.run(`DELETE FROM posts_categories WHERE post_id=?`, [id]);
    const catIds = Array.isArray(selected_categories) ? selected_categories : [selected_categories].filter(Boolean);
    for (let i=0;i<catIds.length;i++){
      await db.run(`INSERT INTO posts_categories(post_id, category_id, is_primary) VALUES(?,?,?)`,
        id, catIds[i], String(catIds[i]) === String(primary_category_id) ? 1 : 0);
    }
    if (catIds.length && !primary_category_id){
      await db.run(`UPDATE posts_categories SET is_primary=1 WHERE post_id=? AND category_id=?`,
        id, catIds[catIds.length-1]);
    }

    return res.redirect("/admin/posts");
  }catch(e){
    const categories = await getCategoriesFlat(db, lang);
    return res.status(400).render("posts/edit", {
      pageTitle: "Sửa bài viết",
      item: { id, title: req.body.title, slug: req.body.slug, content_html: req.body.content_html, status: req.body.status },
      categories,
      selectedCategoryIds: req.body.selected_categories || [],
      primaryCategoryId: req.body.primary_category_id || "",
      tags: [],
      scheduled_at_local: req.body.scheduled_at_local || "",
      created_at_local: "",
      error: e.message
    });
  }
});

export default router;
