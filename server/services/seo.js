// server/services/seo.js
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";

/**
 * Trả về Set tên cột thực tế của bảng seo_meta.
 */
async function getSeoColumns(db) {
  const cols = await db.all(`PRAGMA table_info(seo_meta)`);
  // cols: [{cid, name, type, notnull, dflt_value, pk}, ...]
  return new Set((cols || []).map(c => c.name));
}

/**
 * Chuẩn hoá object SEO từ form:
 * - Lọc chỉ giữ các key an toàn (chữ/số/underscore)
 * - Trim string, ép boolean về "1"/"0" nếu cần
 */
function normalizeSeoForm(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;

  for (const [k, v] of Object.entries(raw)) {
    // chỉ nhận tên dạng a-z0-9_ để tránh lỗi tên cột
    const key = String(k).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    let val = v;

    if (typeof val === "string") {
      val = val.trim();
    } else if (typeof val === "boolean") {
      val = val ? "1" : "0";
    } else if (val == null) {
      val = null;
    } else {
      // object/array => lưu JSON
      try { val = JSON.stringify(val); } catch { val = String(val); }
    }

    out[key] = val;
  }
  return out;
}

/**
 * Đọc 1 bản ghi SEO theo entity.
 * @param {('page'|'post'|'category')} entityType
 * @param {number} entityId
 * @param {string=} language  // nếu bỏ trống sẽ lấy default_language
 */
export async function getSeo(entityType, entityId, language) {
  const db = await getDb();
  const lang = language || await getSetting("default_language", "vi");

  const row = await db.get(
    `SELECT * FROM seo_meta WHERE entity_type = ? AND entity_id = ? AND language = ? LIMIT 1`,
    entityType, entityId, lang
  );

  return row || null;
}

/**
 * Lưu (upsert) SEO theo entity.
 * Tự động:
 * - Chỉ dùng những cột tồn tại trong bảng seo_meta
 * - Build danh sách cột/giá trị động để không bao giờ lệch số lượng
 * - UPDATE nếu đã có dòng, INSERT nếu chưa
 *
 * @param {('page'|'post'|'category')} entityType
 * @param {number} entityId
 * @param {object} formSeo     // dữ liệu từ form seo[...]
 * @param {number=} userId     // updated_by nếu có cột
 * @param {string=} language
 */
export async function saveSeo(entityType, entityId, formSeo, userId, language) {
  if (!formSeo) return;

  const db = await getDb();
  const lang = language || await getSetting("default_language", "vi");
  const existing = await getSeo(entityType, entityId, lang);

  const columnsSet = await getSeoColumns(db);
  const payload = normalizeSeoForm(formSeo);

  // Các cột nhận từ form mà DB thực sự có
  const allowedKeys = Object.keys(payload).filter(k => columnsSet.has(k));

  // Meta-cột mặc định
  const hasUpdatedBy   = columnsSet.has("updated_by");
  const hasCreatedAt   = columnsSet.has("created_at");   // dùng DEFAULT
  const hasUpdatedAt   = columnsSet.has("updated_at");   // sẽ set CURRENT_TIMESTAMP
  const hasLanguage    = columnsSet.has("language");     // đa ngôn ngữ
  const hasEntityType  = columnsSet.has("entity_type");
  const hasEntityId    = columnsSet.has("entity_id");

  // Nếu bảng không có các cột cơ bản này thì bỏ qua (tránh crash)
  if (!hasEntityType || !hasEntityId) return;

  // UPDATE trước nếu đã có
  if (existing) {
    const setParts = [];
    const params = [];

    // các field SEO
    for (const key of allowedKeys) {
      setParts.push(`${key} = ?`);
      params.push(payload[key]);
    }

    // updated_by
    if (hasUpdatedBy) {
      setParts.push(`updated_by = ?`);
      params.push(userId || null);
    }

    // updated_at = CURRENT_TIMESTAMP (nếu có cột)
    const sql =
      `UPDATE seo_meta
          SET ${setParts.join(", ")}${hasUpdatedAt ? ", updated_at = CURRENT_TIMESTAMP" : ""}
        WHERE entity_type = ? AND entity_id = ? ${hasLanguage ? "AND language = ?" : ""}`;

    params.push(entityType, entityId);
    if (hasLanguage) params.push(lang);

    await db.run(sql, ...params);
    return;
  }

  // INSERT nếu chưa có
  const insertCols = [];
  const insertVals = [];
  const placeholders = [];

  // entity keys
  insertCols.push("entity_type");
  insertVals.push(entityType);
  placeholders.push("?");

  insertCols.push("entity_id");
  insertVals.push(entityId);
  placeholders.push("?");

  if (hasLanguage) {
    insertCols.push("language");
    insertVals.push(lang);
    placeholders.push("?");
  }

  // các field SEO hợp lệ
  for (const key of allowedKeys) {
    insertCols.push(key);
    insertVals.push(payload[key]);
    placeholders.push("?");
  }

  // updated_by (nếu có cột)
  if (hasUpdatedBy) {
    insertCols.push("updated_by");
    insertVals.push(userId || null);
    placeholders.push("?");
  }

  // created_at/updated_at: để DB tự set DEFAULT/CURRENT_TIMESTAMP nếu schema có
  const sql =
    `INSERT INTO seo_meta (${insertCols.join(", ")})
     VALUES (${placeholders.join(", ")})`;

  await db.run(sql, ...insertVals);
}

/**
 * Trả về default SEO lấy từ settings (nếu có).
 * Có thể dùng để fill placeholder cho UI.
 */
export async function getSeoDefaults() {
  try {
    const siteName     = await getSetting("site_name", "");
    const defaultTitle = await getSetting("seo_default_title", "");
    const defaultDesc  = await getSetting("seo_default_description", "");
    const defaultOgImg = await getSetting("seo_default_og_image", "");
    const robotsDef    = await getSetting("seo_default_robots", "index,follow");

    return {
      site_name: siteName || "",
      title: defaultTitle || "",
      description: defaultDesc || "",
      og_image: defaultOgImg || "",
      robots: robotsDef || "index,follow"
    };
  } catch {
    return {
      site_name: "",
      title: "",
      description: "",
      og_image: "",
      robots: "index,follow"
    };
  }
}
