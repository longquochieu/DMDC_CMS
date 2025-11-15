// server/routes/sitemap.js
import express from "express";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";

const router = express.Router();

router.get("/sitemap.xml", async (req, res) => {
  try {
    const db = await getDb();
    const lang = await getSetting("default_language", "vi");
    const siteUrl = (await getSetting("seo.site_url", "")) || `${req.protocol}://${req.get('host')}`;

    // Pages
    const pages = await db.all(
      `
      SELECT p.id, t.slug, p.updated_at
      FROM pages p
      LEFT JOIN pages_translations t
        ON t.page_id = p.id AND t.language = ?
      WHERE p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
      LIMIT 2000
      `,
      [lang]
    );

    // Posts (chỉ published)
    const posts = await db.all(
      `
      SELECT p.id, t.slug, p.updated_at
      FROM posts p
      LEFT JOIN posts_translations t
        ON t.post_id = p.id AND t.language = ?
      WHERE p.deleted_at IS NULL AND p.status = 'published'
      ORDER BY p.updated_at DESC
      LIMIT 5000
      `,
      [lang]
    );

    // Categories
    const cats = await db.all(
      `
      SELECT c.id, ct.slug
      FROM categories c
      LEFT JOIN categories_translations ct
        ON ct.category_id = c.id AND ct.language = ?
      WHERE c.deleted_at IS NULL
      ORDER BY c.updated_at DESC
      LIMIT 2000
      `,
      [lang]
    );

    const urls = [];

    // Build URLs (tuỳ routing FE của bạn, tạm thời dùng slug đơn giản)
    pages.forEach(r => {
      if (r.slug) urls.push({ loc: `${siteUrl}/${encodeURIComponent(r.slug)}`, lastmod: r.updated_at });
    });
    posts.forEach(r => {
      if (r.slug) urls.push({ loc: `${siteUrl}/bai-viet/${encodeURIComponent(r.slug)}`, lastmod: r.updated_at });
    });
    cats.forEach(r => {
      if (r.slug) urls.push({ loc: `${siteUrl}/danh-muc/${encodeURIComponent(r.slug)}` });
    });

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `<url>
  <loc>${u.loc}</loc>${u.lastmod ? `\n  <lastmod>${u.lastmod.replace(' ', 'T')}Z</lastmod>` : ""}
</url>`
  )
  .join("\n")}
</urlset>`);
  } catch (e) {
    console.error("[sitemap] error:", e);
    res.status(500).send("Sitemap error");
  }
});

export default router;