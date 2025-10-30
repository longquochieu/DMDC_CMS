// server/services/settings.js
import { getDb } from '../utils/db.js';

export async function getSetting(key, fallback = null) {
  const db = await getDb();
  const row = await db.get('SELECT value FROM settings WHERE key=?', key);
  return (row && row.value != null) ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.run(
    'INSERT INTO settings(key, value) VALUES(?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key, value
  );
  return true;
}

export async function getAllSettings() {
  const db = await getDb();
  const rows = await db.all('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// (tuỳ chọn)
export async function setSettingsMap(mapObj = {}) {
  const db = await getDb();
  await db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(mapObj)) {
      await db.run(
        'INSERT INTO settings(key, value) VALUES(?,?) ' +
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        k, v
      );
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK'); throw e;
  }
}
