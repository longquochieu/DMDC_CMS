// server/routes/settings_seo.js
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';

const router = express.Router();

// Helper lấy nhiều settings theo prefix
async function getMany(db, keysWithDefault = []) {
  const keys = keysWithDefault.map(k => k[0]);
  const rows = await db.all(
    `SELECT key, value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`,
    keys
  );
  const map = new Map(rows.map(r => [r.key, r.value]));
  const out = {};
  for (const [k, defv] of keysWithDefault) {
    out[k] = map.has(k) ? map.get(k) : defv;
  }
  return out;
}

async function upsert(db, key, value) {
  await db.run(
    `INSERT INTO settings(key,value,updated_at)
     VALUES(?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`,
    key, value
  );
}

router.get('/settings/seo', requireAuth, async (req, res) => {
  const db = await getDb();

  const defaults = await getMany(db, [
    ['seo.site_name', ''],
    ['seo.site_url', ''],
    ['seo.title_separator', ' | '],
    ['seo.default_index', '1'],
    ['seo.default_follow', '1'],
    ['seo.og.default_image_url', ''],
    ['seo.twitter.default_image_url', ''],

    ['seo.pattern.post.title', '%title%%sep%%site%'],
    ['seo.pattern.post.description', '%excerpt%'],
    ['seo.pattern.page.title', '%title%%sep%%site%'],
    ['seo.pattern.page.description', '%excerpt%'],
    ['seo.pattern.category.title', '%title%%sep%%site%'],
    ['seo.pattern.category.description', '%excerpt%'],

    ['seo.sitemap.enabled', '0'],
    ['seo.sitemap.include_posts', '1'],
    ['seo.sitemap.include_pages', '1'],
    ['seo.sitemap.include_categories', '1'],
    ['seo.sitemap.changefreq', 'daily'],
    ['seo.sitemap.priority', '0.5'],

    ['seo.robots.enabled', '0'],
    ['seo.robots.custom', ''],

    ['seo.social.default_title', ''],
    ['seo.social.default_description', ''],
  ]);

  res.render('settings/seo', {
    pageTitle: 'Cài đặt SEO',
    data: defaults,
    ok: req.query.ok === '1',
    csrfToken: (req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || ''))
  });
});

router.post('/settings/seo', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  // Lấy dữ liệu từ form
  const body = req.body;

  const kv = {
    'seo.site_name': body['seo.site_name'] || '',
    'seo.site_url': (body['seo.site_url'] || '').trim(),
    'seo.title_separator': body['seo.title_separator'] || ' | ',

    'seo.default_index': body['seo.default_index'] ? '1' : '0',
    'seo.default_follow': body['seo.default_follow'] ? '1' : '0',

    'seo.og.default_image_url': body['seo.og.default_image_url'] || '',
    'seo.twitter.default_image_url': body['seo.twitter.default_image_url'] || '',

    'seo.pattern.post.title': body['seo.pattern.post.title'] || '%title%%sep%%site%',
    'seo.pattern.post.description': body['seo.pattern.post.description'] || '%excerpt%',
    'seo.pattern.page.title': body['seo.pattern.page.title'] || '%title%%sep%%site%',
    'seo.pattern.page.description': body['seo.pattern.page.description'] || '%excerpt%',
    'seo.pattern.category.title': body['seo.pattern.category.title'] || '%title%%sep%%site%',
    'seo.pattern.category.description': body['seo.pattern.category.description'] || '%excerpt%',

    'seo.sitemap.enabled': body['seo.sitemap.enabled'] ? '1' : '0',
    'seo.sitemap.include_posts': body['seo.sitemap.include_posts'] ? '1' : '0',
    'seo.sitemap.include_pages': body['seo.sitemap.include_pages'] ? '1' : '0',
    'seo.sitemap.include_categories': body['seo.sitemap.include_categories'] ? '1' : '0',
    'seo.sitemap.changefreq': body['seo.sitemap.changefreq'] || 'daily',
    'seo.sitemap.priority': body['seo.sitemap.priority'] || '0.5',

    'seo.robots.enabled': body['seo.robots.enabled'] ? '1' : '0',
    'seo.robots.custom': body['seo.robots.custom'] || '',

    'seo.social.default_title': body['seo.social.default_title'] || '',
    'seo.social.default_description': body['seo.social.default_description'] || '',
  };

  // Chuẩn hóa site_url
  if (kv['seo.site_url'] && !/^https?:\/\//i.test(kv['seo.site_url'])) {
    kv['seo.site_url'] = 'https://' + kv['seo.site_url'];
  }
  if (kv['seo.site_url'].endsWith('/')) {
    kv['seo.site_url'] = kv['seo.site_url'].replace(/\/+$/, '');
  }

  for (const [k, v] of Object.entries(kv)) {
    await upsert(db, k, v);
  }

  return res.redirect('/admin/settings/seo?ok=1');
});

export default router;
