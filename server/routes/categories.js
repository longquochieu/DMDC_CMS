
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import { getCategoriesTree } from '../services/tree.js';
import { rebuildCategorySubtreeFullPaths } from '../services/rebuild.js';

const router = express.Router();

// LIST (tree)
router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const tree = await getCategoriesTree(lang);
  res.render('categories/list', { pageTitle:'Categories', tree, lang });
});

// NEW
router.get('/new', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const parents = await db.all('SELECT c.id, t.name as title FROM categories c LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.deleted_at IS NULL ORDER BY t.name', lang);
  res.render('categories/edit', { pageTitle:'New Category', item:null, parents, lang, error:null });
});

router.post('/new', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  try{
    const { name, slug, parent_id, order_index } = req.body;
    await db.run('INSERT INTO categories(parent_id,order_index,created_by,updated_by) VALUES(?,?,?,?)',
      parent_id||null, Number(order_index||0), req.user.id, req.user.id);
    const idRow = await db.get('SELECT last_insert_rowid() AS id');
    await db.run('INSERT INTO categories_translations(category_id,language,name,slug) VALUES(?,?,?,?)',
      idRow.id, lang, name, (slug&&slug.trim())?toSlug(slug):toSlug(name));
    res.redirect('/admin/categories');
  }catch(e){
    const parents = await db.all('SELECT c.id, t.name as title FROM categories c LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.deleted_at IS NULL ORDER BY t.name', lang);
    res.render('categories/edit', { pageTitle:'New Category', item:null, parents, lang, error:e.message });
  }
});

// EDIT
router.get('/:id/edit', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  const parents = await db.all('SELECT c.id, t.name as title FROM categories c LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.deleted_at IS NULL AND c.id != ? ORDER BY t.name', lang, id);
  const item = await db.get(`SELECT c.*, t.name, t.slug, t.full_path FROM categories c
  LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.id=?`, lang, id);
  res.render('categories/edit', { pageTitle:'Edit Category', item, parents, lang, error:null });
});

router.post('/:id/edit', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  try{
    const { name, slug, parent_id, order_index } = req.body;
    await db.run('UPDATE categories SET parent_id=?, order_index=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      parent_id||null, Number(order_index||0), req.user.id, id);
    await db.run('UPDATE categories_translations SET name=?, slug=? WHERE category_id=? AND language=?',
      name, (slug&&slug.trim())?toSlug(slug):toSlug(name), id, lang);
    res.redirect('/admin/categories');
  }catch(e){
    const parents = await db.all('SELECT c.id, t.name as title FROM categories c LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.deleted_at IS NULL AND c.id != ? ORDER BY t.name', lang, id);
    const item = await db.get(`SELECT c.*, t.name, t.slug, t.full_path FROM categories c
      LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=? WHERE c.id=?`, lang, id);
    res.render('categories/edit', { pageTitle:'Edit Category', item, parents, lang, error:e.message });
  }
});

// REORDER (AJAX)
router.post('/reorder', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const { node_id, new_parent_id, new_index, lang } = req.body;
  try{
    await db.run('BEGIN');
    if (new_parent_id) {
      const stack = [Number(new_parent_id)];
      while(stack.length){
        const x=stack.pop();
        if (Number(x)===Number(node_id)) throw new Error('Không thể đặt làm con của chính nó.');
        const kids = await db.all('SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL', x);
        kids.forEach(c=>stack.push(c.id));
      }
    }
    await db.run('UPDATE categories SET parent_id=? WHERE id=?', new_parent_id||null, node_id);
    const siblings = await db.all('SELECT id FROM categories WHERE parent_id IS ? AND deleted_at IS NULL ORDER BY order_index, id', new_parent_id||null);
    for (let i=0;i<siblings.length;i++){
      const target = (siblings[i].id==node_id) ? Number(new_index||0) : (i>=new_index? i+1 : i);
      await db.run('UPDATE categories SET order_index=? WHERE id=?', target, siblings[i].id);
    }
    const updated_paths = await rebuildCategorySubtreeFullPaths(node_id, lang||'vi');
    await db.run('COMMIT');
    res.json({ ok:true, updated_paths });
  }catch(e){
    await db.run('ROLLBACK');
    res.status(409).send(e.message);
  }
});

export default router;
