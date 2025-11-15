// server/services/settings.js
import { getDb } from "../utils/db.js";

/**
 * Tự phát hiện tên cột key/value trong bảng settings.
 * Hỗ trợ các biến thể: name|key|setting_key|k  và  value|setting_value|val|v
 * Đồng thời kiểm tra tồn tại created_at/updated_at để chèn/ cập nhật nếu có.
 */
let _settingsColsCache = null;

async function detectSettingsCols() {
  if (_settingsColsCache) return _settingsColsCache;

  const db = await getDb();
  let cols = [];
  try {
    // Thử MySQL trước (INFORMATION_SCHEMA)
    const mysqlCols = await db.all?.(
      `
      SELECT COLUMN_NAME AS name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings'
      `
    );
    if (mysqlCols && mysqlCols.length) {
      cols = mysqlCols.map((r) => r.name);
    }
  } catch {
    // bỏ qua, có thể không phải MySQL
  }

  // Nếu vẫn rỗng (chưa có bảng), trả về mặc định và để các hàm call site tự fallback
  if (!cols.length) {
    _settingsColsCache = {
      keyCol: "name",
      valCol: "value",
      hasCreatedAt: false,
      hasUpdatedAt: false,
    };
    return _settingsColsCache;
  }

  const pickFirst = (cands) => cands.find((c) => cols.includes(c));
  const keyCol =
    pickFirst(["name", "key", "setting_key", "k"]) || "name";
  const valCol =
    pickFirst(["value", "setting_value", "val", "v"]) || "value";

  _settingsColsCache = {
    keyCol,
    valCol,
    hasCreatedAt: cols.includes("created_at"),
    hasUpdatedAt: cols.includes("updated_at"),
  };
  return _settingsColsCache;
}

/** Lấy số bản ghi bị ảnh hưởng từ kết quả db.run (MySQL/SQLite đều ok) */
function affected(result) {
  if (!result) return 0;
  if (typeof result.affectedRows === "number") return result.affectedRows; // mysql2
  if (typeof result.changes === "number") return result.changes; // sqlite
  return 0;
}

/**
 * Lấy 1 setting theo key. Nếu không có thì trả về defaultValue.
 * Luôn trả về string (giá trị nguyên bản từ DB) hoặc defaultValue.
 */
export async function getSetting(key, defaultValue = null) {
  try {
    const db = await getDb();
    const { keyCol, valCol } = await detectSettingsCols();

    // Đặt alias "value" để code phía trên dùng đồng nhất
    const row = await db.get(
      `SELECT ${valCol} AS value FROM settings WHERE ${keyCol} = ? LIMIT 1`,
      [key]
    );
    if (!row || row.value == null) return defaultValue;
    return row.value;
  } catch {
    // Nếu thiếu bảng/thiếu cột: trả về defaultValue để hệ thống không chết
    return defaultValue;
  }
}

/**
 * Ghi 1 setting: ưu tiên UPDATE trước, nếu không có thì INSERT.
 * Không phụ thuộc UNIQUE KEY hay cú pháp upsert riêng của MySQL/SQLite.
 */
export async function setSetting(key, value) {
  const db = await getDb();
  const { keyCol, valCol, hasCreatedAt, hasUpdatedAt } =
    await detectSettingsCols();

  // 1) Thử UPDATE trước
  const updateSql = `
    UPDATE settings
       SET ${valCol} = ?${hasUpdatedAt ? ", updated_at = CURRENT_TIMESTAMP" : ""}
     WHERE ${keyCol} = ?
  `;
  const upRes = await db.run(updateSql, [value, key]);
  if (affected(upRes) > 0) return true;

  // 2) Nếu chưa có -> INSERT
  const cols = [keyCol, valCol]
    .concat(hasCreatedAt ? ["created_at"] : [])
    .concat(hasUpdatedAt ? ["updated_at"] : []);
  const placeholders = cols.map(() => "?").join(",");

  const insertVals = [key, value];
  if (hasCreatedAt) insertVals.push(new Date().toISOString().slice(0, 19).replace("T", " "));
  if (hasUpdatedAt) insertVals.push(new Date().toISOString().slice(0, 19).replace("T", " "));

  const insertSql = `INSERT INTO settings(${cols.join(", ")}) VALUES (${placeholders})`;
  await db.run(insertSql, insertVals);
  return true;
}

/**
 * Lấy nhiều setting theo danh sách keys (mảng).
 * Nếu không truyền keys => trả về TOÀN BỘ (object name->value theo key thực tế trong DB).
 */
export async function getSettingsBulk(keys = null) {
  const db = await getDb();
  const { keyCol, valCol } = await detectSettingsCols();
  const map = {};

  try {
    if (Array.isArray(keys) && keys.length) {
      const placeholders = keys.map(() => "?").join(",");
      const rows = await db.all(
        `SELECT ${keyCol} AS name, ${valCol} AS value FROM settings WHERE ${keyCol} IN (${placeholders})`,
        keys
      );
      for (const r of rows || []) map[r.name] = r.value;
      return map;
    } else {
      const rows = await db.all(
        `SELECT ${keyCol} AS name, ${valCol} AS value FROM settings`
      );
      for (const r of rows || []) map[r.name] = r.value;
      return map;
    }
  } catch {
    // Nếu bảng chưa tồn tại
    return map;
  }
}

/**
 * Ghi hàng loạt settings từ object {key: value}
 * Dùng chiến lược UPDATE trước, không có thì INSERT (tương tự setSetting).
 */
export async function setSettingsBulk(obj = {}) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return true;

  const db = await getDb();
  const { keyCol, valCol, hasCreatedAt, hasUpdatedAt } =
    await detectSettingsCols();

  for (const [k, v] of entries) {
    const upSql = `
      UPDATE settings
         SET ${valCol} = ?${hasUpdatedAt ? ", updated_at = CURRENT_TIMESTAMP" : ""}
       WHERE ${keyCol} = ?
    `;
    const r = await db.run(upSql, [v, k]);
    if (affected(r) > 0) continue;

    const cols = [keyCol, valCol]
      .concat(hasCreatedAt ? ["created_at"] : [])
      .concat(hasUpdatedAt ? ["updated_at"] : []);
    const placeholders = cols.map(() => "?").join(",");

    const insertVals = [k, v];
    if (hasCreatedAt) insertVals.push(new Date().toISOString().slice(0, 19).replace("T", " "));
    if (hasUpdatedAt) insertVals.push(new Date().toISOString().slice(0, 19).replace("T", " "));

    const insSql = `INSERT INTO settings(${cols.join(", ")}) VALUES (${placeholders})`;
    await db.run(insSql, insertVals);
  }
  return true;
}

/* ========================
 *  ✅ Alias tương thích ngược
 * ======================== */
export async function getAllSettings() {
  return getSettingsBulk(null);
}
// Một số nơi có thể import getSettings -> alias về bulk
export const getSettings = getSettingsBulk;
