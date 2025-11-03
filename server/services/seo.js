// server/services/seo.js
import { getDb } from "../utils/db.js";

/** =========================================================
 *  Cache schema seo_meta (dò cột tồn tại)
 * ========================================================= */
let _seoCols = null;
async function getSeoMetaColumns() {
  if (_seoCols) return _seoCols;
  const db = await getDb();
  try {
    const rows = await db.all(`PRAGMA table_info(seo_meta)`);
    const names = new Set(rows.map(r => r.name));
    _seoCols = names;
  } catch {
    _seoCols = new Set();
  }
  return _seoCols;
}
async function hasCol(name) {
  const cols = await getSeoMetaColumns();
  return cols.has(name);
}

/** =========================================================
 *  Defaults (chuẩn RankMath tối thiểu)
 * ========================================================= */
export function getSeoDefaults() {
  return {
    // Basic
    title: "",
    description: "",
    focus_keyword: "",

    // Robots
    robots_index: "index",
    robots_follow: "follow",
    robots_advanced: "",

    // Advanced
    canonical: "",
    schema_type: "",
    schema_jsonld: "",

    // Social
    og_title: "",
    og_description: "",
    og_image: "",
    twitter_title: "",
    twitter_description: "",
    twitter_image: "",
  };
}

/** =========================================================
 *  Lấy SEO theo entity (chịu được bảng có/không cột language)
 *  - Trả về object đã merge defaults để view không lỗi
 * ========================================================= */
export async function getSeo(entityType, entityId, language = "vi") {
  const db = await getDb();
  const cols = await getSeoMetaColumns();

  // Quyết định điều kiện WHERE dựa vào cột có/không
  const where = ["entity_type = ?", "entity_id = ?"];
  const params = [entityType, entityId];
  if (cols.has("language")) {
    where.push("language = ?");
    params.push(language);
  }

  // SELECT * để không nêu đích danh cột (tránh thiếu cột)
  const row = await db.get(
    `SELECT * FROM seo_meta WHERE ${where.join(" AND ")} LIMIT 1`,
    params
  );

  const defaults = getSeoDefaults();
  if (!row) return defaults;

  // Chỉ lấy các key mà view/logic quan tâm; key không có trong row thì giữ defaults
  const out = { ...defaults };
  for (const k of Object.keys(defaults)) {
    if (k in row && row[k] != null) out[k] = String(row[k]);
  }
  return out;
}

/** =========================================================
 *  Suy luận ảnh Social (ưu tiên Featured → ảnh đầu tiên trong content)
 * ========================================================= */
async function getEntityMediaContext(entityType, entityId, language = "vi") {
  const db = await getDb();

  if (entityType === "post") {
    const featured = await db.get(
      `SELECT m.url AS url
         FROM media_usages mu
         JOIN media m ON m.id = mu.media_id
        WHERE mu.post_id = ? AND mu.field = 'featured'
        ORDER BY mu.position
        LIMIT 1`,
      [entityId]
    );
    const t = await db.get(
      `SELECT content_html FROM posts_translations WHERE post_id = ? AND language = ? LIMIT 1`,
      [entityId, language]
    );
    return { featuredUrl: featured?.url || "", contentHtml: t?.content_html || "" };
  }

  if (entityType === "page") {
    const featured = await db.get(
      `SELECT m.url AS url
         FROM pages p
         LEFT JOIN media m ON m.id = p.featured_media_id
        WHERE p.id = ?
        LIMIT 1`,
      [entityId]
    );
    const t = await db.get(
      `SELECT content_html FROM pages_translations WHERE page_id = ? AND language = ? LIMIT 1`,
      [entityId, language]
    );
    return { featuredUrl: featured?.url || "", contentHtml: t?.content_html || "" };
  }

  // Category: hiện tại chưa có featured/content mặc định
  return { featuredUrl: "", contentHtml: "" };
}
function extractFirstImage(html = "") {
  const re = /<img[^>]+src=["']([^"']+)["']/i;
  const m = re.exec(html || "");
  return m ? (m[1] || "").trim() : "";
}
function inferSocialImage({ featuredUrl, contentHtml }) {
  if (featuredUrl && featuredUrl.trim()) return featuredUrl.trim();
  const fromContent = extractFirstImage(contentHtml);
  return (fromContent || "").trim();
}
function norm(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** =========================================================
 *  Upsert SEO (tự dò cột có trong bảng rồi build SQL động)
 *  - Không crash nếu bảng thiếu cột (vd: description/language)
 *  - Ảnh social auto lấy Featured → ảnh đầu tiên trong nội dung (nếu user không nhập)
 * ========================================================= */
export async function saveSeo(entityType, entityId, seoForm, userId = null, language = "vi") {
  const db = await getDb();
  const cols = await getSeoMetaColumns();

  // Bản chuẩn hóa input
  const seo = {
    title: norm(seoForm.title),
    description: norm(seoForm.description),
    focus_keyword: norm(seoForm.focus_keyword),
    robots_index: norm(seoForm.robots_index) || "index",
    robots_follow: norm(seoForm.robots_follow) || "follow",
    robots_advanced: norm(seoForm.robots_advanced),
    canonical: norm(seoForm.canonical),
    schema_type: norm(seoForm.schema_type),
    schema_jsonld: norm(seoForm.schema_jsonld),
    og_title: norm(seoForm.og_title),
    og_description: norm(seoForm.og_description),
    og_image: norm(seoForm.og_image),
    twitter_title: norm(seoForm.twitter_title),
    twitter_description: norm(seoForm.twitter_description),
    twitter_image: norm(seoForm.twitter_image),
  };

  // Suy luận OG/Twitter image nếu user để trống
  if ((!seo.og_image || !seo.twitter_image) && (await hasCol("og_image") || await hasCol("twitter_image"))) {
    const ctx = await getEntityMediaContext(entityType, entityId, language);
    const inferred = inferSocialImage(ctx);
    if (!seo.og_image && inferred) seo.og_image = inferred;
    if (!seo.twitter_image && (seo.og_image || inferred)) {
      seo.twitter_image = seo.og_image || inferred;
    }
  }

  // Xác định cặp khóa
  const where = ["entity_type = ?", "entity_id = ?"];
  const whereParams = [entityType, entityId];
  if (cols.has("language")) {
    where.push("language = ?");
    whereParams.push(language);
  }

  // Kiểm tra tồn tại
  const existed = await db.get(
    `SELECT id FROM seo_meta WHERE ${where.join(" AND ")} LIMIT 1`,
    whereParams
  );

  // Mapping field → column (ở đây trùng tên; nếu DB bạn dùng tên khác, đổi từng key tại đây)
  const fieldToCol = {
    title: "title",
    description: "description",
    focus_keyword: "focus_keyword",
    robots_index: "robots_index",
    robots_follow: "robots_follow",
    robots_advanced: "robots_advanced",
    canonical: "canonical",
    schema_type: "schema_type",
    schema_jsonld: "schema_jsonld",
    og_title: "og_title",
    og_description: "og_description",
    og_image: "og_image",
    twitter_title: "twitter_title",
    twitter_description: "twitter_description",
    twitter_image: "twitter_image",
  };

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  if (existed) {
    // ===== UPDATE động =====
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(fieldToCol)) {
      if (await hasCol(col)) {
        sets.push(`${col} = ?`);
        params.push(seo[k]);
      }
    }
    if (await hasCol("updated_at")) {
      sets.push("updated_at = ?");
      params.push(now);
    }
    if (await hasCol("updated_by")) {
      sets.push("updated_by = ?");
      params.push(userId);
    }

    if (sets.length) {
      await db.run(
        `UPDATE seo_meta SET ${sets.join(", ")} WHERE ${where.join(" AND ")}`,
        [...params, ...whereParams]
      );
    }
  } else {
    // ===== INSERT động =====
    const colsList = [];
    const valsList = [];
    const params = [];

    // Khóa
    if (await hasCol("entity_type")) { colsList.push("entity_type"); valsList.push("?"); params.push(entityType); }
    if (await hasCol("entity_id"))   { colsList.push("entity_id");   valsList.push("?"); params.push(entityId); }
    if (await hasCol("language"))    { colsList.push("language");    valsList.push("?"); params.push(language); }

    // Data
    for (const [k, col] of Object.entries(fieldToCol)) {
      if (await hasCol(col)) {
        colsList.push(col);
        valsList.push("?");
        params.push(seo[k]);
      }
    }

    // Audit
    if (await hasCol("created_at")) { colsList.push("created_at"); valsList.push("?"); params.push(now); }
    if (await hasCol("created_by")) { colsList.push("created_by"); valsList.push("?"); params.push(userId); }
    if (await hasCol("updated_at")) { colsList.push("updated_at"); valsList.push("?"); params.push(now); }
    if (await hasCol("updated_by")) { colsList.push("updated_by"); valsList.push("?"); params.push(userId); }

    if (colsList.length === 0) {
      // Bảng seo_meta không có cột nào khả dụng → báo lỗi rõ ràng để bạn tạo schema
      throw new Error("Bảng seo_meta không có cột phù hợp để lưu. Vui lòng bổ sung schema.");
    }

    await db.run(
      `INSERT INTO seo_meta (${colsList.join(", ")}) VALUES (${valsList.join(", ")})`,
      params
    );
  }

  return true;
}
