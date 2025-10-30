// server/routes/pages.js
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import sanitizeHtml from 'sanitize-html';
import { getPagesTree } from '../services/tree.js';
import { rebuildPageSubtreeFullPaths } from '../services/rebuild.js';
import { buildFullPathForPage } from '../services/hierarchy.js';
import { logActivity } from '../services/activity.js';

const router = express.Router();

function cleanHtml(input){
  const cfg = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','iframe','table','thead','tbody','tr','th','td']),
    allowedAttributes: {
      a: ['href','name','target','rel'],
      img: ['src','alt','width','height'],
      iframe: ['src','width','height','frameborder','allow','referrerpolicy','allowfullscreen'],
      '*': ['style','class','align']
    },
    allowedIframeHostnames: ['www.youtube.com','youtube.com','youtu.be'],
    transformTags: {
      iframe: function(tagName, attribs){
        try{
          const url = new URL(attribs.src||'', 'http://x');
          const host = url.hostname.replace(/^www\./,'');
          if (!['youtube.com','youtu.be'].includes(host) && host.indexOf('youtube.com')===-1) {
            return { tagName:'p', text:'' };
          }
        }catch(e){ return { tagName:'p', text:'' }; }
        attribs.referrerpolicy = 'strict-origin-when-cross-origin';
        attribs.allow = attribs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        return { tagName:'iframe', attribs };
      }
    }
  };
  return sanitizeHtml(input||'', cfg);
}

// LIST (tree)
router.get('/', requireAuth, async (req, res) => {
  const lang = await getSetting('default_language','vi');
  const tree = await getPagesTree(lang);
  res.render('pages/list', { pageTitle:'Pages', tree, lang });
});

// NEW
router.get('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const parents = await db.all(
    'SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL ORDER BY t.title',
    lang
  );
  res.render('pages/edit', { pageTitle:'New Page', item:null, parents, lang, error:null });
});

router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  try{
    const { title, slug, status, parent_id, content_html, order_index } = req.body;
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    await db.run(
      'INSERT INTO pages(status,parent_id,order_index,created_by,updated_by) VALUES(?,?,?,?,?)',
      status||'draft', parent_id||null, Number(order_index||0), req.user.id, req.user.id
    );

    const idRow = await db.get('SELECT last_insert_rowid() AS id');
    await db.run(
      'INSERT INTO pages_translations(page_id,language,title,slug,content_html) VALUES(?,?,?,?,?)',
      idRow.id, lang, title, theSlug, cleanHtml(content_html||'')
    );

    const full = await buildFullPathForPage(idRow.id, lang);
    await db.run('UPDATE pages_translations SET full_path=? WHERE page_id=? AND language=?', full, idRow.id, lang);

    await logActivity(req.user.id, 'create', 'page', idRow.id);
    res.redirect('/admin/pages');
  }catch(e){
    const parents = await db.all(
      'SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL ORDER BY t.title',
      lang
    );
    res.render('pages/edit', { pageTitle:'New Page', item:null, parents, lang, error:e.message });
  }
});

// EDIT - form
router.get('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');

  const parents = await db.all(
    'SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL AND p.id != ? ORDER BY t.title',
    lang, id
  );

  const item = await db.get(`
    SELECT p.*, t.title, t.slug, t.full_path, t.content_html
    FROM pages p
    LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
    WHERE p.id=?`,
    lang, id
  );

  res.render('pages/edit', { pageTitle:'Edit Page', item, parents, lang, error:null });
});

// EDIT - submit
router.post('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const id = req.params.id;
  try{
    const { title, slug, status, parent_id, content_html, order_index } = req.body;

    await db.run(
      'UPDATE pages SET parent_id=?, status=?, order_index=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      parent_id || null, status || 'draft', Number(order_index||0), req.user.id, id
    );

    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    await db.run(
      'UPDATE pages_translations SET title=?, slug=?, content_html=? WHERE page_id=? AND language=?',
      title, theSlug, cleanHtml(content_html||''), id, lang
    );

    const full = await buildFullPathForPage(id, lang);
    await db.run('UPDATE pages_translations SET full_path=? WHERE page_id=? AND language=?', full, id, lang);

    await logActivity(req.user.id, 'update', 'page', id);
    res.redirect('/admin/pages');
  }catch(e){
    const parents = await db.all(
      'SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL AND p.id != ? ORDER BY t.title',
      lang, id
    );
    const item = await db.get(`
      SELECT p.*, t.title, t.slug, t.full_path, t.content_html
      FROM pages p
      LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
      WHERE p.id=?`,
      lang, id
    );
    res.render('pages/edit', { pageTitle:'Edit Page', item, parents, lang, error:e.message });
  }
});

// REORDER (AJAX) — chống lock + reindex ổn định
router.post('/reorder', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  let { node_id, new_parent_id, new_index, lang } = req.body;

  try {
    node_id = Number(node_id);
    const newIdx = Number(new_index ?? 0);
    const parentId = (new_parent_id === '' || new_parent_id == null) ? null : Number(new_parent_id);
    const langUse = lang || 'vi';

    await db.exec('BEGIN IMMEDIATE');

    // chặn cycle
    if (parentId != null) {
      const stack = [parentId];
      while (stack.length) {
        const x = stack.pop();
        if (Number(x) === node_id) throw new Error('Không thể đặt làm con của chính nó.');
        const kids = await db.all('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL', x);
        for (const c of kids) stack.push(c.id);
      }
    }

    // cập nhật cha
    await db.run('UPDATE pages SET parent_id = ? WHERE id = ?', parentId, node_id);

    // lấy danh sách sibling (loại bỏ node_id)
    let siblings = [];
    if (parentId == null) {
      siblings = await db.all(
        'SELECT id FROM pages WHERE parent_id IS NULL AND deleted_at IS NULL AND id <> ? ORDER BY order_index, id',
        node_id
      );
    } else {
      siblings = await db.all(
        'SELECT id FROM pages WHERE parent_id = ? AND deleted_at IS NULL AND id <> ? ORDER BY order_index, id',
        parentId, node_id
      );
    }

    // chèn node vào vị trí mới rồi reindex tuần tự
    const ordered = siblings.map(s => s.id);
    const insertAt = Math.max(0, Math.min(newIdx, ordered.length));
    ordered.splice(insertAt, 0, node_id);

    for (let i = 0; i < ordered.length; i++) {
      await db.run('UPDATE pages SET order_index = ? WHERE id = ?', i, ordered[i]);
    }

    // rebuild full_path cho cây con
    const updated_paths = await rebuildPageSubtreeFullPaths(node_id, langUse);

    await db.exec('COMMIT');
    res.json({ ok: true, updated_paths });
  } catch (e) {
    try { await db.exec('ROLLBACK'); } catch {}
    res.status(409).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * POST /admin/pages/:id/trash
 * - Chặn xoá is_home
 * - Chặn xoá nếu còn children chưa xoá
 * - Soft delete: set deleted_at = now
 */
router.post('/:id/trash', requireRoles('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = await getDb();

  const row = await db.get('SELECT id, is_home FROM pages WHERE id=? AND deleted_at IS NULL', id);
  if (!row) return res.redirect('/admin/pages?err=not_found');
  if (row.is_home === 1) return res.redirect('/admin/pages?err=cannot_delete_home');

  const child = await db.get('SELECT 1 FROM pages WHERE parent_id=? AND deleted_at IS NULL LIMIT 1', id);
  if (child) return res.redirect('/admin/pages?err=has_children');

  await db.run('UPDATE pages SET deleted_at = datetime("now") WHERE id=?', id);
  if (req.flash) req.flash('success', 'Đã chuyển Page vào Trash.');
  await logActivity(req.user.id, 'trash', 'page', id);
  return res.redirect('/admin/pages');
});

/**
 * POST /admin/pages/:id/restore
 * - Khôi phục từ trash: set deleted_at = NULL
 */
router.post('/:id/restore', requireRoles('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = await getDb();

  const row = await db.get('SELECT id FROM pages WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!row) return res.redirect('/admin/trash?err=not_in_trash');

  await db.run('UPDATE pages SET deleted_at = NULL WHERE id=?', id);
  await logActivity(req.user.id, 'restore', 'page', id);
  return res.redirect('/admin/trash?ok=restored');
});

export default router;
