import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const stats = {
    posts: (await db.get('SELECT COUNT(*) c FROM posts WHERE deleted_at IS NULL')).c,
    pages: (await db.get('SELECT COUNT(*) c FROM pages WHERE deleted_at IS NULL')).c,
    media: (await db.get('SELECT COUNT(*) c FROM media WHERE deleted_at IS NULL')).c,
    users: (await db.get('SELECT COUNT(*) c FROM users')).c
  };
  res.render('dashboard', { pageTitle: 'Dashboard', stats });
});

export default router;
