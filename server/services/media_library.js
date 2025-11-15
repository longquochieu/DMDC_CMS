// server/services/media_library.js
import { getDb } from "../utils/db.js";

/**
 * Truy vấn danh sách media với filter:
 *  - folder_id: lọc theo thư mục (null => tất cả)
 *      + "uncategorized" => chỉ file chưa gán thư mục
 *  - q: tìm theo filename / original_name / url (LIKE)
 *  - mime: image|video|doc|'' (nhóm mime)
 *  - sort: name_asc|name_desc|size_asc|size_desc|created_at_asc|created_at_desc
 *  - page, size: phân trang
 */
export async function queryMedia({
  folder_id = null,
  q = "",
  mime = "",
  sort = "created_at_desc",
  page = 1,
  size = 30,
} = {}) {
  const db = await getDb();

  page = Math.max(1, Number(page) || 1);
  size = Math.max(1, Math.min(100, Number(size) || 30));
  const offset = (page - 1) * size;

  const where = ["m.deleted_at IS NULL"];
  const params = [];

  // --- lọc theo folder ---
  const fid = folder_id;
  if (fid === "uncategorized") {
    // chỉ file chưa gán vào thư mục nào
    where.push(`
      NOT EXISTS (
        SELECT 1 FROM media_folder_items mfi
        WHERE mfi.media_id = m.id
      )
    `);
  } else if (fid !== null && fid !== "" && !Number.isNaN(Number(fid))) {
    where.push(`
      EXISTS (
        SELECT 1 FROM media_folder_items mfi
        WHERE mfi.media_id = m.id
          AND mfi.folder_id = ?
      )
    `);
    params.push(Number(fid));
  }

  // --- keyword ---
  const qq = (q || "").trim();
  if (qq) {
    const like = `%${qq}%`;
    where.push(`(m.filename LIKE ? OR m.original_name LIKE ? OR m.url LIKE ?)`);
    params.push(like, like, like);
  }

  // --- mime group ---
  const mg = (mime || "").toLowerCase();
  if (mg === "image") {
    where.push("m.mime_type LIKE 'image/%'");
  } else if (mg === "video") {
    where.push("m.mime_type LIKE 'video/%'");
  } else if (mg === "doc") {
    where.push("m.mime_type LIKE 'application/%'");
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // --- sort ---
  let orderSql = "m.created_at DESC";
  switch (sort) {
    case "name_asc":
      orderSql = "m.original_name ASC";
      break;
    case "name_desc":
      orderSql = "m.original_name DESC";
      break;
    case "size_asc":
      orderSql = "m.size_bytes ASC";
      break;
    case "size_desc":
      orderSql = "m.size_bytes DESC";
      break;
    case "created_at_asc":
      orderSql = "m.created_at ASC";
      break;
    case "created_at_desc":
    default:
      orderSql = "m.created_at DESC";
  }

  // ⚠️ Không dùng placeholder cho LIMIT/OFFSET với MySQL
  const sqlList = `
    SELECT
      m.id,
      m.url,
      m.filename,
      m.original_name,
      m.mime_type,
      m.size_bytes,
      m.created_at
    FROM media m
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${size} OFFSET ${offset}
  `;

  const rows = await db.all(sqlList, params);

  // --- đếm tổng ---
  const countRow = await db.get(
    `SELECT COUNT(*) AS total FROM media m ${whereSql}`,
    params
  );

  return {
    rows,
    page,
    size,
    total: countRow?.total ?? 0,
  };
}
