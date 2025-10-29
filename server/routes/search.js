import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';

const router = express.Router();
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const db = await getDb();
  let pages = [], posts = [];
  if (q) {
    pages = await db.all('SELECT rowid as id, title FROM pages_fts WHERE pages_fts MATCH ? LIMIT 50', q);
    posts = await db.all('SELECT rowid as id, title FROM posts_fts WHERE posts_fts MATCH ? LIMIT 50', q);
  }
  res.render('search/index', { pageTitle:'Search', q, pages, posts });
});
export default router;
