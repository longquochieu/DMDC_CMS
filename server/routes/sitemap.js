// server/routes/sitemap.js
import express from 'express';
import { getDb } from '../utils/db.js';

const router = express.Router();

async function getSetting(db, key, def = '') {
  const r = await db.get(`SELECT value FROM settings WHERE key = ?`, key);
  return r ? String(r.value ?? '') : def;
}

function xmlEscape(s='') {
  return s.replace(/[<>&'"]/g, c => (
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '&' ? '&amp;' :
    c === '"' ? '&quot;' : '&#39;'
  ));
}

router.get('/sitemap.xml', async (req, res) => {
  const db = await getDb();
  const enabled = await getSetting(db, 'seo.sitemap.enabled', '0');
  if (enabled !== '1') return res.status(404).send('Not found');

  const siteUrl = (await getSetting(db, 'seo.site_url', '')).replace(/\/+$/,'');
  if (!siteUrl) return res.status(500).send('Missing seo.site_url in settings');

  const lang = await getSetting(db, 'default_language', 'vi');
  const includePosts = (await getSetting(db, 'seo.sitemap.include_posts', '1')) === '1';
  const includePages = (await getSetting(db, 'seo.sitemap.include_pages', '1')) === '1';
  const includeCategories = (await getSetting(db, 'seo.sitemap.include_categories', '1')) === '1';
  const changefreq = await getSetting(db, 'seo.sitemap.changefreq', 'daily');
  const priority = await getSetting(db, 'seo.sitemap.priority', '0.5');

  const urls = [];

  if (includePages) {
    const rows = await db.all(`
      SELECT t.full_path AS path, p.updated_at AS updated_at
      FROM pages p
      LEFT JOIN pages_translations t ON t.page_id = p.id AND t.language = ?
      WHERE p.deleted_at IS NULL AND t.full_path IS NOT NULL
    `, lang);
    for (const r of rows) {
      const loc = siteUrl + (r.path.startsWith('/') ? r.path : `/${r.path}`);
      urls.push({ loc, lastmod: r.updated_at || r.created_at });
    }
  }

  if (includePosts) {
    const rows = await db.all(`
      SELECT t.slug AS slug, p.updated_at AS updated_at
      FROM posts p
      LEFT JOIN posts_translations t ON t.post_id = p.id AND t.language = ?
      WHERE p.deleted_at IS NULL AND p.status='published' AND t.slug IS NOT NULL
    `, lang);
    for (const r of rows) {
      // TODO: điều chỉnh route frontend của post nếu khác
      const loc = `${siteUrl}/post/${r.slug}`;
      urls.push({ loc, lastmod: r.updated_at });
    }
  }

  if (includeCategories) {
    const rows = await db.all(`
      SELECT ct.slug AS slug
      FROM categories c
      LEFT JOIN categories_translations ct ON ct.category_id = c.id AND ct.language = ?
      WHERE c.deleted_at IS NULL AND ct.slug IS NOT NULL
    `, lang);
    for (const r of rows) {
      // TODO: điều chỉnh route frontend của category nếu khác
      const loc = `${siteUrl}/category/${r.slug}`;
      urls.push({ loc, lastmod: null });
    }
  }

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send([
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map(u => {
      const parts = [
        `<url>`,
        `<loc>${xmlEscape(u.loc)}</loc>`,
      ];
      if (u.lastmod) parts.push(`<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>`);
      parts.push(`<changefreq>${xmlEscape(changefreq)}</changefreq>`);
      parts.push(`<priority>${xmlEscape(priority)}</priority>`);
      parts.push(`</url>`);
      return parts.join('');
    }),
    `</urlset>`
  ].join('\n'));
});

export default router;
