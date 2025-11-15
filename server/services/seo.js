// server/services/seo.js
import { getDb } from "../utils/db.js";
import { getSetting, getSettingsBulk } from "./settings.js";

/**
 * Dò schema bảng seo_meta để tự động map cột:
 * - entityCol: 'entity' | 'entity_type'
 * - descCol:   'meta_description' | 'description'
 * - ogImageCol: 'og_image_url' | 'og_image'
 * - twImageCol: 'twitter_image_url' | 'twitter_image'
 * - has.created_at / has.updated_at
 * - tồn tại của các cột nội dung (title, focus_keyword, robots_*, ...)
 */
async function getSeoSchema() {
  const db = await getDb();

  // Bảng tồn tại không?
  const tbl = await db.get(`
    SELECT COUNT(*) AS n
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seo_meta'
  `, []);
  if (!tbl || !tbl.n) {
    return { exists: false };
  }

  const rows = await db.all(`
    SELECT COLUMN_NAME AS c
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seo_meta'
  `, []);
  const set = new Set((rows || []).map(r => r.c));

  const choose = (...cands) => cands.find(c => set.has(c)) || null;

  const entityCol = choose('entity', 'entity_type');
  const descCol   = choose('meta_description', 'description');
  const ogImageCol = choose('og_image_url', 'og_image');
  const twImageCol = choose('twitter_image_url', 'twitter_image');

  // Danh sách cột nội dung (để Update/Insert động)
  const cols = {
    title: choose('title', 'seo_title'),
    meta_description: descCol,
    focus_keyword: choose('focus_keyword', 'focus_keyphrase', 'keyword'),
    robots_index: choose('robots_index'),
    robots_follow: choose('robots_follow'),
    robots_advanced: choose('robots_advanced'),
    canonical_url: choose('canonical_url'),
    schema_type: choose('schema_type'),
    schema_jsonld: choose('schema_jsonld'),
    og_title: choose('og_title'),
    og_description: choose('og_description'),
    og_image_url: ogImageCol,
    twitter_title: choose('twitter_title'),
    twitter_description: choose('twitter_description'),
    twitter_image_url: twImageCol,
  };

  return {
    exists: true,
    entityCol,
    has: {
      created_at: set.has('created_at'),
      updated_at: set.has('updated_at'),
      language: set.has('language'), // (bắt buộc theo thiết kế)
      entity_id: set.has('entity_id'),
    },
    cols,
  };
}

/**
 * Lấy SEO cụ thể theo entity/id/lang
 * Trả về object với các key chuẩn (title, meta_description, ...); nếu cột ko tồn tại -> trả ""
 */
export async function getSeo(entity, entityId, language = "vi") {
  const db = await getDb();
  const sch = await getSeoSchema();
  if (!sch.exists || !sch.entityCol || !sch.has.language || !sch.has.entity_id) {
    return {}; // ko có bảng hoặc thiếu cột bắt buộc -> coi như chưa cấu hình
  }
  const row = await db.get(
    `SELECT * FROM seo_meta WHERE ${sch.entityCol} = ? AND entity_id = ? AND language = ? LIMIT 1`,
    [String(entity || ""), Number(entityId) || 0, String(language || "vi")]
  );

  if (!row) return {};

  const out = {};
  // Map an toàn: nếu cột không tồn tại -> trả ""
  for (const [key, col] of Object.entries(sch.cols)) {
    out[key] = col ? (row[col] ?? "") : "";
  }
  return out;
}

/**
 * Lưu SEO (upsert). Tự tương thích schema.
 * payload có thể bao gồm các key: title, meta_description, focus_keyword, robots_index, robots_follow,
 * robots_advanced, canonical_url, schema_type, schema_jsonld, og_title, og_description, og_image_url,
 * twitter_title, twitter_description, twitter_image_url
 */
export async function saveSeo(entity, entityId, language = "vi", payload = {}) {
  const db = await getDb();
  const sch = await getSeoSchema();

  // Nếu chưa có bảng hoặc thiếu các cột bắt buộc -> bỏ qua yên lặng (không làm hỏng luồng tạo/sửa page/category)
  if (!sch.exists || !sch.entityCol || !sch.has.language || !sch.has.entity_id) {
    return false;
  }

  // Gom các cặp (col,value) chỉ với cột thật sự tồn tại
  const colVals = [];
  for (const [key, col] of Object.entries(sch.cols)) {
    if (!col) continue; // cột không tồn tại
    // dùng key chuẩn trong payload (nếu thiếu -> null để xoá giá trị hoặc giữ nguyên? Chọn mặc định: string "")
    const v = Object.prototype.hasOwnProperty.call(payload, key)
      ? (payload[key] ?? "")
      : "";
    colVals.push([col, v]);
  }

  // 1) thử UPDATE trước
  const setParts = [];
  const params = [];
  for (const [col, v] of colVals) {
    setParts.push(`\`${col}\` = ?`);
    params.push(v);
  }
  if (sch.has.updated_at) {
    setParts.push(`updated_at = CURRENT_TIMESTAMP`);
  }
  const whereParams = [String(entity || ""), Number(entityId) || 0, String(language || "vi")];
  const updateSql = `
    UPDATE seo_meta
       SET ${setParts.length ? setParts.join(", ") : "entity_id = entity_id"}
     WHERE ${sch.entityCol} = ? AND entity_id = ? AND language = ?
  `;
  const r = await db.run(updateSql, [...params, ...whereParams]);
  const affected = r?.affectedRows ?? r?.changes ?? 0;

  if (affected > 0) return true;

  // 2) chưa có bản ghi => INSERT
  const cols = [sch.entityCol, "entity_id", "language"];
  const vals = [String(entity || ""), Number(entityId) || 0, String(language || "vi")];
  const qmarks = ["?", "?", "?"];

  for (const [col, v] of colVals) {
    cols.push(col);
    vals.push(v);
    qmarks.push("?");
  }
  // created_at/updated_at nếu có
  if (sch.has.created_at) {
    cols.push("created_at");
    qmarks.push("CURRENT_TIMESTAMP");
  }
  if (sch.has.updated_at) {
    cols.push("updated_at");
    qmarks.push("CURRENT_TIMESTAMP");
  }

  const insertSql = `
    INSERT INTO seo_meta (${cols.map(c => `\`${c}\``).join(", ")})
    VALUES (${qmarks.join(", ")})
  `;
  await db.run(insertSql, vals);
  return true;
}

/**
 * Lấy default SEO (để prefill form) từ settings.
 * Không phụ thuộc bảng phụ nào khác, tránh lỗi "Unknown column 'name'..."
 */
export async function getSeoDefaults(scope = null) {
  // các key settings sẽ dùng. Nếu chưa có thì trả fallback.
  const keys = [
    "seo_default_index",
    "seo_default_follow",
    "seo_schema_default_type",
    "seo_schema_default_jsonld",
  ];
  const map = await getSettingsBulk(keys);

  return {
    robots_index: map.seo_default_index ?? "index",
    robots_follow: map.seo_default_follow ?? "follow",
    schema_type: map.seo_schema_default_type ?? "",
    schema_jsonld: map.seo_schema_default_jsonld ?? "",
  };
}
