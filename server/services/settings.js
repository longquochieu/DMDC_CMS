// server/services/settings.js
import { getDb } from "../utils/db.js";

/**
 * Lấy 1 setting theo key. Trả fallback nếu không có.
 */
export async function getSetting(key, fallback = null) {
  const db = await getDb();
  const row = await db.get(
    `SELECT value FROM settings WHERE key = ? LIMIT 1`,
    key
  );
  if (!row || row.value == null || row.value === "") return fallback;
  return row.value;
}

/**
 * Ghi 1 setting theo key (UPSERT).
 */
export async function setSetting(key, value) {
  const db = await getDb();
  const val = String(value ?? "");
  await db.run(
    `INSERT INTO settings(key, value)
       VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, val]
  );
}

/**
 * Lấy nhiều setting 1 lượt theo danh sách keys.
 */
export async function getSettingsBulk(keys = [], defaults = {}) {
  if (!Array.isArray(keys) || keys.length === 0) return {};
  const db = await getDb();
  const placeholders = keys.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
    keys
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const k of keys) {
    out[k] = map.has(k) ? map.get(k) : (defaults[k] ?? "");
  }
  return out;
}

/**
 * Ghi nhiều setting 1 lượt (transaction + UPSERT).
 */
export async function setSettingsBulk(kv = {}) {
  const db = await getDb();
  await db.run("BEGIN IMMEDIATE");
  try {
    for (const [k, v] of Object.entries(kv)) {
      await db.run(
        `INSERT INTO settings(key, value)
           VALUES(?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [k, String(v ?? "")]
      );
    }
    await db.run("COMMIT");
  } catch (e) {
    await db.run("ROLLBACK");
    throw e;
  }
}

/**
 * Lấy TOÀN BỘ settings dưới dạng object { key: value }.
 */
export async function getAllSettings() {
  const db = await getDb();
  const rows = await db.all(`SELECT key, value FROM settings`);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
