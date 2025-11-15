import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const qRaw = (req.query.q || "").trim();
  const db = await getDb();

  let pages = [];
  let posts = [];

  if (qRaw) {
    // Ngôn ngữ mặc định
    const lang = await getSetting("default_language", "vi");

    // Chuẩn bị query kiểu BOOLEAN MODE: mỗi từ thêm * cho fulltext
    const terms = qRaw.split(/\s+/).filter(Boolean);
    const booleanQuery = terms.length
      ? terms.map((t) => `${t}*`).join(" ")
      : qRaw;

    // PAGES
    pages = await db.all(
      `
      SELECT DISTINCT
        p.id,
        COALESCE(t.title, CONCAT('[Page #', p.id, ']')) AS title
      FROM pages p
      JOIN pages_translations t ON t.page_id = p.id
      WHERE p.deleted_at IS NULL
        AND t.language = ?
        AND MATCH (t.title, t.slug, t.content_html)
            AGAINST (? IN BOOLEAN MODE)
      ORDER BY title
      LIMIT 50
      `,
      [lang, booleanQuery]
    );

    // POSTS
    posts = await db.all(
      `
      SELECT DISTINCT
        p.id,
        COALESCE(t.title, CONCAT('[Post #', p.id, ']')) AS title
      FROM posts p
      JOIN posts_translations t ON t.post_id = p.id
      WHERE p.deleted_at IS NULL
        AND t.language = ?
        AND MATCH (t.title, t.slug, t.content_html)
            AGAINST (? IN BOOLEAN MODE)
      ORDER BY title
      LIMIT 50
      `,
      [lang, booleanQuery]
    );
  }

  res.render("search/index", {
    pageTitle: "Search",
    q: qRaw,
    pages,
    posts,
  });
});

export default router;
