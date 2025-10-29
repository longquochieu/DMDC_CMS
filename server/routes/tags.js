import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const rows = await db.all(`SELECT t.id, tt.name, tt.slug FROM tags t LEFT JOIN tags_translations tt ON tt.tag_id=t.id AND tt.language=?
    WHERE t.deleted_at IS NULL ORDER BY tt.name`, lang);
  res.render('tags/list', { pageTitle:'Tags', rows });
});

router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const { name, slug } = req.body;
  const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(name);
  await db.run('INSERT INTO tags DEFAULT VALUES');
  const id = (await db.get('SELECT last_insert_rowid() as id')).id;
  await db.run('INSERT INTO tags_translations(tag_id,language,name,slug) VALUES(?,?,?,?)', id, lang, name, theSlug);
  res.redirect('/admin/tags');
});

router.post('/:id/delete', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  await db.run('UPDATE tags SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', req.params.id);
  res.redirect('/admin/tags');
});

export default router;
