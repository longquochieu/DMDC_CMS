// server/services/seo.js
import { getDb } from "../utils/db.js";
import { getSetting } from "./settings.js";

/* ------------------ Defaults & small helpers ------------------ */

/** Đọc default SEO settings (có fallback) */
export async function getSeoDefaults() {
  const keys = [
    "site_url",
    "seo_title_pattern_post",
    "seo_title_pattern_page",
    "seo_title_pattern_category",
    "seo_meta_desc_max",
    "seo_default_index",
    "seo_default_follow",
    "seo_robots_advanced",
    "seo_og_default_title",
    "seo_og_default_description",
    "seo_og_default_image_url",
    "seo_twitter_card_type",
    "seo_twitter_default_title",
    "seo_twitter_default_description",
    "seo_twitter_default_image_url",
    "seo_sitemap_enabled",
    "seo_schema_default_type",
    "seo_schema_default_jsonld",
  ];
  const out = {};
  for (const k of keys) out[k] = await getSetting(k, "");
  if (!out.site_url) out.site_url = "http://localhost:5000";
  if (!out.seo_meta_desc_max) out.seo_meta_desc_max = "160";
  if (!out.seo_default_index) out.seo_default_index = "index";
  if (!out.seo_default_follow) out.seo_default_follow = "follow";
  if (!out.seo_twitter_card_type) out.seo_twitter_card_type = "summary_large_image";
  if (!out.seo_sitemap_enabled) out.seo_sitemap_enabled = "1";
  return out;
}

/** Lấy tên site (để thế %site% trong pattern) */
async function getSiteName() {
  // tuỳ hệ thống bạn đang lưu ở settings key nào
  const siteName = await getSetting("site_name", "");
  if (siteName) return siteName;
  const siteTitle = await getSetting("site_title", "");
  if (siteTitle) return siteTitle;
  const url = await getSetting("site_url", "Website");
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "Website";
  }
}

/** Tìm ảnh đầu tiên trong HTML */
export function findFirstImageInHtml(html = "") {
  if (!html) return "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

/** Loại bỏ HTML + cắt theo độ dài tối đa */
export function stripHtmlAndTruncate(html = "", maxLen = 160) {
  const text = (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trim() + "…";
}

/** PRAGMA kiểm tra cột có tồn tại không (cache nhẹ) */
const _tableInfoCache = new Map();
async function columnExists(db, table, column) {
  const key = `${table}::${column}`;
  if (_tableInfoCache.has(key)) return _tableInfoCache.get(key);
  const rows = await db.all(`PRAGMA table_info(${table})`);
  const ok = rows.some((r) => String(r.name).toLowerCase() === String(column).toLowerCase());
  _tableInfoCache.set(key, ok);
  return ok;
}

/* ------------------ Social image picking (ưu tiên ảnh đại diện) ------------------ */

/**
 * Chọn ảnh OG/Twitter:
 * - Post: ưu tiên media_usages(field='featured') → ảnh đầu tiên trong content_html → ảnh default
 * - Page: ưu tiên pages.featured_media_id → ảnh đầu tiên trong content_html → ảnh default
 * - Category: ảnh đầu tiên trong content_html → ảnh default
 */
export async function pickSocialImageForEntity(db, entityType, entityId, defaults) {
  if (entityType === "post") {
    const featured = await db.get(
      `SELECT m.url
         FROM media_usages mu
         JOIN media m ON m.id = mu.media_id
        WHERE mu.field = 'featured' AND mu.post_id = ?
        ORDER BY mu.position LIMIT 1`,
      entityId
    );
    if (featured?.url) return featured.url;

    const row = await db.get(
      `SELECT t.content_html
         FROM posts_translations t
        WHERE t.post_id = ? LIMIT 1`,
      entityId
    );
    const first = findFirstImageInHtml(row?.content_html || "");
    if (first) return first;
  }

  if (entityType === "page") {
    const f = await db.get(
      `SELECT m.url
         FROM pages p LEFT JOIN media m ON m.id = p.featured_media_id
        WHERE p.id = ?`,
      entityId
    );
    if (f?.url) return f.url;

    const row = await db.get(
      `SELECT t.content_html
         FROM pages_translations t
        WHERE t.page_id = ? LIMIT 1`,
      entityId
    );
    const first = findFirstImageInHtml(row?.content_html || "");
    if (first) return first;
  }

  if (entityType === "category") {
    const row = await db.get(
      `SELECT t.content_html
         FROM categories_translations t
        WHERE t.category_id = ? LIMIT 1`,
      entityId
    );
    const first = findFirstImageInHtml(row?.content_html || "");
    if (first) return first;
  }

  return defaults.seo_og_default_image_url || "";
}

/* ------------------ Main: getSeo / saveSeo ------------------ */

/**
 * Đọc SEO cho 1 entity. Nếu chưa có trong bảng seo_meta → sinh mặc định
 * Trả về object đã “điền sẵn”:
 * {
 *   title, meta_description, focus_keyword,
 *   robots_index, robots_follow, robots_advanced,
 *   canonical_url,
 *   schema_type, schema_jsonld,
 *   og_title, og_description, og_image_url,
 *   twitter_title, twitter_description, twitter_image_url
 * }
 */
export async function getSeo(entityType, entityId, lang = "vi") {
  const db = await getDb();
  const defaults = await getSeoDefaults();

  // 1) cố lấy từ seo_meta (ưu tiên có language)
  let row = null;
  try {
    row = await db.get(
      `SELECT * FROM seo_meta WHERE entity_type=? AND entity_id=? AND language=? LIMIT 1`,
      entityType, entityId, lang
    );
  } catch (e) {
    if (/no such column:\s*language/i.test(String(e.message))) {
      row = await db.get(
        `SELECT * FROM seo_meta WHERE entity_type=? AND entity_id=? LIMIT 1`,
        entityType, entityId
      );
    } else {
      throw e;
    }
  }

  // 2) Nếu có, return (chuẩn hoá tên trường mô tả cho đồng nhất)
  if (row) {
    // Map description/meta_description về meta_description
    if (row.description && !row.meta_description) {
      row.meta_description = row.description;
    }
    return row;
  }

  // 3) Auto-fill mặc định từ nội dung entity
  const site = await getSiteName();
  const maxDesc = Number(defaults.seo_meta_desc_max || 160);

  // Lấy tiêu đề & nội dung thô
  let baseTitle = "";
  let html = "";
  if (entityType === "post") {
    const t = await db.get(
      `SELECT title, content_html FROM posts_translations WHERE post_id=? AND language=?`,
      entityId, lang
    ).catch(async (e) => {
      // fallback không ngôn ngữ
      return await db.get(
        `SELECT title, content_html FROM posts_translations WHERE post_id=? LIMIT 1`,
        entityId
      );
    });
    baseTitle = t?.title || "";
    html = t?.content_html || "";
  } else if (entityType === "page") {
    const t = await db.get(
      `SELECT title, content_html FROM pages_translations WHERE page_id=? AND language=?`,
      entityId, lang
    ).catch(async () => {
      return await db.get(
        `SELECT title, content_html FROM pages_translations WHERE page_id=? LIMIT 1`,
        entityId
      );
    });
    baseTitle = t?.title || "";
    html = t?.content_html || "";
  } else if (entityType === "category") {
    const t = await db.get(
      `SELECT name AS title, content_html FROM categories_translations WHERE category_id=? AND language=?`,
      entityId, lang
    ).catch(async () => {
      return await db.get(
        `SELECT name AS title, content_html FROM categories_translations WHERE category_id=? LIMIT 1`,
        entityId
      );
    });
    baseTitle = t?.title || "";
    html = t?.content_html || "";
  }

  // Pattern theo loại
  let pattern = "%title% | %site%";
  if (entityType === "post" && defaults.seo_title_pattern_post) pattern = defaults.seo_title_pattern_post;
  if (entityType === "page" && defaults.seo_title_pattern_page) pattern = defaults.seo_title_pattern_page;
  if (entityType === "category" && defaults.seo_title_pattern_category) pattern = defaults.seo_title_pattern_category;

  const seoTitle = (pattern || "%title% | %site%")
    .replace(/%title%/g, baseTitle || "")
    .replace(/%site%/g, site || "");

  const metaDesc = stripHtmlAndTruncate(html || "", maxDesc);
  const socialImage = await pickSocialImageForEntity(db, entityType, entityId, defaults);

  return {
    title: seoTitle,
    meta_description: metaDesc,
    focus_keyword: "",
    robots_index: defaults.seo_default_index || "index",
    robots_follow: defaults.seo_default_follow || "follow",
    robots_advanced: defaults.seo_robots_advanced || "",
    canonical_url: "",
    schema_type: defaults.seo_schema_default_type || "",
    schema_jsonld: defaults.seo_schema_default_jsonld || "",
    og_title: defaults.seo_og_default_title || seoTitle,
    og_description: defaults.seo_og_default_description || metaDesc,
    og_image_url: socialImage || defaults.seo_og_default_image_url || "",
    twitter_title: defaults.seo_twitter_default_title || seoTitle,
    twitter_description: defaults.seo_twitter_default_description || metaDesc,
    twitter_image_url: socialImage || defaults.seo_twitter_default_image_url || "",
  };
}

/**
 * Lưu (upsert) SEO cho entity. Tự động thích nghi:
 * - có/không có cột language
 * - bảng dùng meta_description hay description
 * data có thể gồm:
 * {
 *   title, meta_description (hoặc description), focus_keyword,
 *   robots_index, robots_follow, robots_advanced,
 *   canonical_url,
 *   schema_type, schema_jsonld,
 *   og_title, og_description, og_image_url,
 *   twitter_title, twitter_description, twitter_image_url
 * }
 */
export async function saveSeo(entityType, entityId, lang, data = {}) {
  const db = await getDb();

  // Kiểm tra cột tồn tại để map động
  const hasLanguage = await columnExists(db, "seo_meta", "language");
  const hasMetaDescription = await columnExists(db, "seo_meta", "meta_description");
  const hasDescription = await columnExists(db, "seo_meta", "description");

  // Chuẩn hoá tên trường mô tả
  const payload = { ...data };
  if (!payload.meta_description && payload.description) {
    payload.meta_description = payload.description;
  }

  // Tập cột “ứng viên” (tùy bảng có cột nào sẽ set cột đó)
  const candidateCols = [
    "title",
    "meta_description", // hoặc description
    "focus_keyword",
    "robots_index",
    "robots_follow",
    "robots_advanced",
    "canonical_url",
    "schema_type",
    "schema_jsonld",
    "og_title",
    "og_description",
    "og_image_url",
    "twitter_title",
    "twitter_description",
    "twitter_image_url",
  ];

  // Xây map cột thực sự có trong DB
  const colsToUse = [];
  for (const col of candidateCols) {
    if (col === "meta_description") {
      if (hasMetaDescription) colsToUse.push("meta_description");
      else if (hasDescription) colsToUse.push("description");
      continue;
    }
    if (await columnExists(db, "seo_meta", col)) {
      colsToUse.push(col);
    }
  }

  // Kiểm tra tồn tại dòng
  let existing = null;
  try {
    if (hasLanguage) {
      existing = await db.get(
        `SELECT id FROM seo_meta WHERE entity_type=? AND entity_id=? AND language=? LIMIT 1`,
        entityType, entityId, lang
      );
    } else {
      existing = await db.get(
        `SELECT id FROM seo_meta WHERE entity_type=? AND entity_id=? LIMIT 1`,
        entityType, entityId
      );
    }
  } catch (e) {
    // nếu bảng chưa đúng, ném lỗi ra để dev biết
    throw e;
  }

  if (existing) {
    // UPDATE
    const sets = [];
    const vals = [];
    for (const col of colsToUse) {
      // map meta_description -> description nếu cần
      const payloadKey = (col === "description" ? "meta_description" : col);
      sets.push(`${col} = ?`);
      vals.push(payload[payloadKey] ?? "");
    }
    let sql = `UPDATE seo_meta SET ${sets.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE entity_type=? AND entity_id=?`;
    vals.push(entityType, entityId);
    if (hasLanguage) {
      sql += ` AND language=?`;
      vals.push(lang);
    }
    await db.run(sql, ...vals);
  } else {
    // INSERT
    const cols = ["entity_type", "entity_id"];
    const placeholders = ["?", "?"];
    const vals = [entityType, entityId];

    if (hasLanguage) {
      cols.push("language");
      placeholders.push("?");
      vals.push(lang);
    }
    for (const col of colsToUse) {
      cols.push(col);
      placeholders.push("?");
      const payloadKey = (col === "description" ? "meta_description" : col);
      vals.push(payload[payloadKey] ?? "");
    }
    const sql = `INSERT INTO seo_meta(${cols.join(",")}) VALUES(${placeholders.join(",")})`;
    await db.run(sql, ...vals);
  }
}
