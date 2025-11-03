// server/routes/seo-public.js
import express from "express";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";

const router = express.Router();

/** robots.txt động */
router.get("/robots.txt", async (req, res) => {
  const siteUrl = await getSetting("site_url", "http://localhost:5000");
  const index = await getSetting("seo_default_index", "index");
  const follow = await getSetting("seo_default_follow", "follow");

  const disallowAll = (index === "noindex"); // nếu mặc định noindex thì chặn
  const lines = [
    "User-agent: *",
    disallowAll ? "Disallow: /" : "Allow: /",
    "",
    `Sitemap: ${siteUrl.replace(/\/+$/,"")}/sitemap.xml`
  ];

  res.type("text/plain").send(lines.join("\n"));
});

/** sitemap.xml cơ bản */
router.get("/sitemap.xml", async (req, res) => {
  const enabled = await getSetting("seo_sitemap_enabled", "1");
  if (enabled !== "1") {
    return res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>`);
  }

  const siteUrl = (await getSetting("site_url", "http://localhost:5000")).replace(/\/+$/,"");
  const db = await getDb();

  const urls = [];

  // Pages (published)
  const pages = await db.all(`
    SELECT t.full_path, p.updated_at
      FROM pages p
      JOIN pages_translations t ON t.page_id = p.id
     WHERE p.deleted_at IS NULL AND p.status = 'published'
  `);
  for (const r of pages) {
    const loc = `${siteUrl}${r.full_path || ""}`;
    urls.push({ loc, lastmod: r.updated_at || null });
  }

  // Posts (published)
  const posts = await db.all(`
    SELECT t.slug, p.updated_at, p.created_at
      FROM posts p
      JOIN posts_translations t ON t.post_id = p.id
     WHERE p.deleted_at IS NULL
       AND (p.status='published' OR (p.status='scheduled' AND p.scheduled_at <= CURRENT_TIMESTAMP))
  `);
  for (const r of posts) {
    const loc = `${siteUrl}/post/${r.slug}`;
    const lastmod = r.updated_at || r.created_at || null;
    urls.push({ loc, lastmod });
  }

  // Categories (optional)
  const cats = await db.all(`
    SELECT ct.slug
      FROM categories c
      JOIN categories_translations ct ON ct.category_id = c.id
     WHERE c.deleted_at IS NULL
  `);
  for (const r of cats) {
    const loc = `${siteUrl}/category/${r.slug}`;
    urls.push({ loc, lastmod: null });
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map(u => {
      const last = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : "";
      return `<url><loc>${u.loc}</loc>${last}</url>`;
    }),
    `</urlset>`
  ].join("");

  res.type("application/xml").send(xml);
});

export default router;
