// server/services/media_folders.js
import { getDb } from "../utils/db.js";
import { logActivity } from "./activity.js";
import { queryMedia } from "./media_library.js";

/** Lấy next order_index trong cùng parent */
async function _nextOrderIndex(db, parentId) {
  let row;
  if (parentId == null) {
    row = await db.get(
      `
      SELECT COALESCE(MAX(order_index), -1) + 1 AS next
      FROM media_folders
      WHERE parent_id IS NULL
        AND deleted_at IS NULL
      `
    );
  } else {
    row = await db.get(
      `
      SELECT COALESCE(MAX(order_index), -1) + 1 AS next
      FROM media_folders
      WHERE parent_id = ?
        AND deleted_at IS NULL
      `,
      [parentId]
    );
  }
  return row?.next ?? 0;
}


/** Lấy cây thư mục + file_count */
export async function listTreeWithCounts() {
  const db = await getDb();

  const rows = await db.all(
    `
    SELECT
      f.id,
      f.parent_id,
      f.name,
      f.order_index,
      f.deleted_at,
      COUNT(mfi.media_id) AS file_count
    FROM media_folders f
    LEFT JOIN media_folder_items mfi
      ON mfi.folder_id = f.id
    WHERE f.deleted_at IS NULL
    GROUP BY f.id, f.parent_id, f.name, f.order_index, f.deleted_at
    ORDER BY
      (f.parent_id IS NULL) DESC,
      f.parent_id,
      f.order_index,
      f.name
    `
  );

  const byId = new Map();
  rows.forEach((r) => {
    byId.set(r.id, {
      id: r.id,
      parent_id: r.parent_id,
      name: r.name,
      order_index: r.order_index,
      file_count: r.file_count || 0,
      children: [],
    });
  });

  const roots = [];
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

/** Tạo folder mới */
export async function createFolder({ name, parent_id = null, userId }) {
  const db = await getDb();
  const orderIndex = await _nextOrderIndex(db, parent_id ?? null);

  await db.run(
    `
    INSERT INTO media_folders (parent_id, name, order_index, deleted_at, updated_at)
    VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)
    `,
    [parent_id ?? null, String(name || "Thư mục mới"), orderIndex]
  );

  const row = await db.get(`SELECT LAST_INSERT_ID() AS id`);
  const id = row?.id;

  try {
    await logActivity(userId, "create", "media_folder", id);
  } catch {}

  return id;
}

/** Đổi tên folder */
export async function renameFolder(id, name, userId) {
  const db = await getDb();
  await db.run(
    `
    UPDATE media_folders
       SET name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
    `,
    [String(name || ""), id]
  );
  try {
    await logActivity(userId, "rename", "media_folder", id);
  } catch {}
}

/** Chống vòng lặp khi di chuyển folder */
async function _checkNoCycle(db, id, newParentId) {
  if (!newParentId) return;
  if (id === newParentId) {
    throw new Error("Không thể đặt thư mục làm con của chính nó");
  }

  let current = newParentId;
  while (current) {
    const row = await db.get(
      `
      SELECT parent_id
      FROM media_folders
      WHERE id = ? AND deleted_at IS NULL
      `,
      [current]
    );
    if (!row) break;
    if (row.parent_id === id) {
      throw new Error("Không thể di chuyển thư mục vào chính cây con của nó");
    }
    current = row.parent_id;
  }
}

/** Di chuyển folder sang parent khác */
export async function moveFolder(
  id,
  new_parent_id = null,
  new_index = 0,
  userId
) {
  const db = await getDb();
  await _checkNoCycle(db, id, new_parent_id ?? null);

  await db.exec("BEGIN");
  try {
    const orderIndex = await _nextOrderIndex(db, new_parent_id ?? null);
    await db.run(
      `
      UPDATE media_folders
         SET parent_id = ?, order_index = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
      `,
      [new_parent_id ?? null, orderIndex, id]
    );

    await db.exec("COMMIT");
    try {
      await logActivity(userId, "move", "media_folder", id);
    } catch {}
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/** Xoá mềm folder (không xoá file) */
export async function softDeleteFolder(id, userId) {
  const db = await getDb();
  await db.run(
    `
    UPDATE media_folders
       SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = ?
    `,
    [id]
  );
  try {
    await logActivity(userId, "trash", "media_folder", id);
  } catch {}
}

/** Gán nhiều file vào folder */
export async function assignItems(folder_id, media_ids = [], userId) {
  if (!Array.isArray(media_ids) || media_ids.length === 0) return;
  const db = await getDb();
  await db.exec("BEGIN");
  try {
    for (const mid of media_ids) {
      await db.run(
        `
        INSERT IGNORE INTO media_folder_items (folder_id, media_id)
        VALUES (?, ?)
        `,
        [folder_id, mid]
      );
    }
    await db.exec("COMMIT");
    try {
      await logActivity(userId, "assign", "media_folder", folder_id);
    } catch {}
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/** Bỏ gán file khỏi folder */
export async function unassignItems(folder_id, media_ids = [], userId) {
  if (!Array.isArray(media_ids) || media_ids.length === 0) return;
  const db = await getDb();
  await db.exec("BEGIN");
  try {
    for (const mid of media_ids) {
      await db.run(
        `
        DELETE FROM media_folder_items
        WHERE folder_id = ? AND media_id = ?
        `,
        [folder_id, mid]
      );
    }
    await db.exec("COMMIT");
    try {
      await logActivity(userId, "unassign", "media_folder", folder_id);
    } catch {}
  } catch (e) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/**
 * API cho doclib: trả về { rows, total, page, page_size }
 * để render EJS grid/list
 */
export async function listMediaByFolder(opts = {}) {
  const {
    folder_id = null,
    q = "",
    mime = "",
    sort = "filename",
    dir = "asc",
    page = 1,
    page_size = 12,
  } = opts;

  const s = String(sort || "").toLowerCase();
  const d = String(dir || "asc").toLowerCase();

  let sortKey = "created_at_desc";
  if (s === "filename" || s === "title" || s === "name") {
    sortKey = d === "asc" ? "name_asc" : "name_desc";
  } else if (s === "size") {
    sortKey = d === "asc" ? "size_asc" : "size_desc";
  } else if (s === "created_at" || s === "date") {
    sortKey = d === "asc" ? "created_at_asc" : "created_at_desc";
  }

  const result = await queryMedia({
    folder_id,
    q,
    mime,
    sort: sortKey,
    page,
    size: page_size,
  });

  const rows = (result.rows || []).map((r) => ({
    url: r.url,
    filename: r.filename || r.original_name || "",
    mime: r.mime_type || "",
    size: r.size_bytes || 0,
    created_at: r.created_at,
  }));

  return {
    rows,
    total: result.total,
    page: result.page,
    page_size,
  };
}

/** Wrapper nếu cần phân trang đầy đủ ở chỗ khác */
export async function listMediaPageByFolder(folder_id, opts = {}) {
  return queryMedia({ folder_id, ...opts });
}
