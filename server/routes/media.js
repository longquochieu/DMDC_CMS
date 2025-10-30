import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';

const router = express.Router();

// ✅ Trang Media index
router.get('/', requireAuth, async (req, res, next) => {
	try {
		const db = await getDb();
		const rows = await db.all(`
		  SELECT id, url, original_filename, mime, size_bytes, created_at
		  FROM media
		  WHERE deleted_at IS NULL
		  ORDER BY created_at DESC
		  LIMIT 200
		`);
		res.render('media/index', { pageTitle: 'Media', items: rows });
	  } catch (e) { next(e); }
	});

router.get('/list', requireAuth, async (req, res) => {
const db = await getDb();
  const q = (req.query.q || '').trim();
  const sql = q
    ? `SELECT * FROM media WHERE deleted_at IS NULL AND original_filename LIKE ? ORDER BY created_at DESC LIMIT 200`
    : `SELECT * FROM media WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`;
  const rows = q ? await db.all(sql, `%${q}%`) : await db.all(sql);
  res.json(rows);
});


router.get('/:id/usage', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  const rows = await db.all(`
    SELECT 'post' as type, p.id, pt.title
    FROM media_usages mu
    JOIN posts p ON p.id=mu.post_id
    LEFT JOIN posts_translations pt ON pt.post_id=p.id
    WHERE mu.media_id=?
  `, id);
  res.json({ usages: rows });
});

router.post('/:id/delete', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  const confirm = (req.body.confirm==='true');
  const cnt = await db.get('SELECT COUNT(*) AS c FROM media_usages WHERE media_id=?', id);
  if (cnt.c > 0 && !confirm){
    return res.status(409).json({ error: 'Media is used', usages: cnt.c });
  }
  await db.run('UPDATE media SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', id);
  res.json({ ok:true });
});

export default router;
