// server/routes/robots.js
import express from 'express';
import { getDb } from '../utils/db.js';

const router = express.Router();

async function getSetting(db, key, def = '') {
  const r = await db.get(`SELECT value FROM settings WHERE key = ?`, key);
  return r ? String(r.value ?? '') : def;
}

router.get('/robots.txt', async (req, res) => {
  const db = await getDb();
  const enabled = await getSetting(db, 'seo.robots.enabled', '0');
  if (enabled !== '1') {
    return res.status(404).send('Not found');
  }

  const lines = [];
  lines.push('User-agent: *');

  // Bạn có thể bổ sung logic Index/Follow toàn cục nếu muốn
  // Mặc định cho phép crawl; chặn admin:
  lines.push('Disallow: /admin');

  const custom = await getSetting(db, 'seo.robots.custom', '');
  if (custom.trim()) {
    lines.push(...custom.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  }

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

export default router;
