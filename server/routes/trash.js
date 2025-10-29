import express from 'express';
import { requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';

const router = express.Router();

router.get('/', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const posts = await db.all('SELECT id, deleted_at FROM posts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const pages = await db.all('SELECT id, deleted_at FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const categories = await db.all('SELECT id, deleted_at FROM categories WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const tags = await db.all('SELECT id, deleted_at FROM tags WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const media = await db.all('SELECT id, deleted_at FROM media WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  res.render('trash/index', { pageTitle:'Trash', posts, pages, categories, tags, media });
});

router.post('/restore/:table/:id', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const table = req.params.table;
  const id = req.params.id;
  await db.run(`UPDATE ${table} SET deleted_at=NULL WHERE id=?`, id);
  res.redirect('/admin/trash');
});

router.post('/destroy/:table/:id', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const table = req.params.table;
  const id = req.params.id;
  await db.run(`DELETE FROM ${table} WHERE id=?`, id);
  res.redirect('/admin/trash');
});

router.post('/empty', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  await db.run('DELETE FROM posts WHERE deleted_at IS NOT NULL');
  await db.run('DELETE FROM pages WHERE deleted_at IS NOT NULL');
  await db.run('DELETE FROM categories WHERE deleted_at IS NOT NULL');
  await db.run('DELETE FROM tags WHERE deleted_at IS NOT NULL');
  await db.run('DELETE FROM media WHERE deleted_at IS NOT NULL');
  res.redirect('/admin/trash');
});

export default router;
