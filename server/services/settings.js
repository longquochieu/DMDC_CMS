import { getDb } from '../utils/db.js';

export async function getSetting(key, defaultValue = null) {
  const db = await getDb();
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
}

export async function getAllSettings() {
  const db = await getDb();
  const rows = await db.all('SELECT key, value FROM settings');
  const out = {};
  rows.forEach(r => out[r.key] = r.value);
  return out;
}
