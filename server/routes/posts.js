// server/routes/posts.js
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import sanitizeHtml from 'sanitize-html';
import { logActivity } from '../services/activity.js';

const router = express.Router();

function cleanHtml(input) {
  const cfg = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img','iframe','table','thead','tbody','tr','th','td'
    ]),
    allowedAttributes: {
      a: ['href','name','target','rel'],
      img: ['src','alt','width','height'],
      iframe: ['src','width','height','frameborder','allow','referrerpolicy','allowfullscreen'],
      '*': ['style','class','align']
    },
    allowedIframeHostnames: ['www.youtube.com','youtube.com','youtu.be'],
    transformTags: {
      iframe(tagName, attribs) {
        try {
          const url = new URL(attribs.src || '', 'http://x');
          const host = url.hostname.replace(/^www\./, '');
          if (!['youtube.com','youtu.be'].includes(host) && host.indexOf('youtube.com') === -1) {
            return { tagName: 'p', text: '' };
          }
        } catch {
          return { tagName: 'p', text: '' };
        }
        attribs.referrerpolicy = 'strict-origin-when-cross-origin';
        attribs.allow = attribs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        return { tagName: 'iframe', attribs };
      }
    }
  };
  return sanitizeHtml(input || '', cfg);
}

/* =========================
 * LIST
 * ========================= */
router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language', 'vi');

  const sort = (req.query.sort || 'created_at').toString();
  const dirRaw = (req.query.dir || 'desc').toString().toLowerCase();
  const dir = dirRaw === 'asc' ? 'ASC' : 'DESC';
  const sortMap = {
    title: "LOWER(COALESCE(t.title,''))",
    status: "p.status",
    display_date: "p.display_date",
    created_at: "p.created_at",
    updated_at: "p.updated_at",
  };
  const orderBy = sortMap[sort] || sortMap.created_at;

  const items = await db.all(`
    SELECT
      p.id, p.status, p.display_date, p.created_at, p.updated_at,
      u.username AS author,
      t.title, t.slug,
      f.url AS featured_url
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN media f ON f.id = p.featured_media_id
    WHERE p.deleted_at IS NULL
    ORDER BY ${orderBy} ${dir}, p.id DESC
  `, lang);

  // categories
  const cats = await db.all(`
    SELECT pc.post_id, GROUP_CONCAT(ct.name, ', ') AS categories
    FROM posts_categories pc
    LEFT JOIN categories_translations ct
      ON ct.category_id = pc.category_id AND ct.language = ?
    GROUP BY pc.post_id
  `, lang);
  const catMap = Object.fromEntries(cats.map(r => [r.post_id, r.categories || '']));

  // tags
  const tg = await db.all(`
    SELECT pt.post_id, GROUP_CONCAT(tt.name, ', ') AS tags
    FROM posts_tags pt
    LEFT JOIN tags_translations tt
      ON tt.tag_id = pt.tag_id AND tt.language = ?
    GROUP BY pt.post_id
  `, lang);
  const tagMap = Object.fromEntries(tg.map(r => [r.post_id, r.tags || '']));

  items.forEach(it => {
    it.categories = catMap[it.id] || '';
    it.tags = tagMap[it.id] || '';
  });

  res.render('posts/list', { pageTitle: 'Posts', items, lang, sort, dir });
});

/* =========================
 * NEW
 * ========================= */
router.get('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');

  const categories = await db.all(`
    SELECT c.id, t.name AS title
    FROM categories c
    LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
    WHERE c.deleted_at IS NULL
    ORDER BY COALESCE(t.name, ''), c.id
  `, lang);

  const tags = await db.all(`
    SELECT tg.id, t.name
    FROM tags tg
    LEFT JOIN tags_translations t ON t.tag_id=tg.id AND t.language=?
    WHERE tg.deleted_at IS NULL
    ORDER BY COALESCE(t.name, ''), tg.id
  `, lang);

  res.render('posts/edit', {
    pageTitle: 'New Post',
    item: null,
    categories,
    tags,
    selectedCategoryIds: [],
    selectedTagIds: [],
    featured: null,
    gallery: [],
    lang,
    error: null
  });
});

router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');

  try {
    const {
      title, slug, status, display_date, scheduled_at,
      excerpt, content_html,
      primary_category_id,
      featured_media_id,
      tag_ids, category_ids,
      gallery_ids
    } = req.body;

    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    await db.exec('BEGIN');

    await db.run(`
      INSERT INTO posts(status, display_date, scheduled_at, primary_category_id, featured_media_id, created_by, updated_by)
      VALUES(?,?,?,?,?,?,?)
    `,
      status || 'draft',
      display_date || null,
      scheduled_at || null,
      primary_category_id || null,
      featured_media_id || null,
      req.user.id,
      req.user.id
    );

    const { id } = await db.get('SELECT last_insert_rowid() AS id');

    await db.run(`
      INSERT INTO posts_translations(post_id,language,title,slug,excerpt,content_html)
      VALUES(?,?,?,?,?,?)
    `, id, lang, title || '', theSlug, excerpt || '', cleanHtml(content_html || ''));

    // categories
    const cats = Array.isArray(category_ids)
      ? category_ids
      : (category_ids ? String(category_ids).split(',') : []);
    for (const c of cats.filter(Boolean)) {
      await db.run(`INSERT OR IGNORE INTO posts_categories(post_id, category_id) VALUES(?,?)`, id, Number(c));
    }

    // tags
    const tags = Array.isArray(tag_ids)
      ? tag_ids
      : (tag_ids ? String(tag_ids).split(',') : []);
    for (const t of tags.filter(Boolean)) {
      await db.run(`INSERT OR IGNORE INTO posts_tags(post_id, tag_id) VALUES(?,?)`, id, Number(t));
    }

    // gallery
    const gal = Array.isArray(gallery_ids)
      ? gallery_ids
      : (gallery_ids ? String(gallery_ids).split(',') : []);
    let pos = 0;
    for (const mid of gal.filter(Boolean)) {
      await db.run(`
        INSERT INTO media_usages(post_id, media_id, field, position)
        VALUES(?, ?, 'gallery', ?)
      `, id, Number(mid), pos++);
    }

    await logActivity(req.user.id, 'create', 'post', id);
    await db.exec('COMMIT');

    return res.redirect('/admin/posts');
  } catch (e) {
    await (await getDb()).exec('ROLLBACK');
    console.error(e);

    const categories = await (await getDb()).all(`
      SELECT c.id, t.name AS title
      FROM categories c
      LEFT JOIN categories_translations t ON t.category_id=c.id AND t.language=?
      WHERE c.deleted_at IS NULL ORDER BY COALESCE(t.name,''), c.id
    `, lang);
    const tags = await (await getDb()).all(`
      SELECT tg.id, t.name
      FROM tags tg
      LEFT JOIN tags_translations t ON t.tag_id=tg.id AND t.language=?
      WHERE tg.deleted_at IS NULL ORDER BY COALESCE(t.name,''), tg.id
    `, lang);

    res.render('posts/edit', {
      pageTitle: 'New Post',
      item: null,
      categories,
      tags,
      selectedCategoryIds: [],
      selectedTagIds: [],
      featured: null,
      gallery: [],
      lang,
      error: e.message || String(e)
    });
  }
});

/* =========================
 * EDIT
 * ========================= */
router.get('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const id = Number(req.params.id);

  const item = await db.get(`
    SELECT p.*, t.title, t.slug, t.excerpt, t.content_html
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    WHERE p.id=?
  `, lang, id);

  const categories = await db.all(`
    SELECT c.id, tt.name AS title
    FROM categories c
    LEFT JOIN categories_translations tt ON tt.category_id=c.id AND tt.language=?
    WHERE c.deleted_at IS NULL
    ORDER BY COALESCE(tt.name,''), c.id
  `, lang);

  const tags = await db.all(`
    SELECT tg.id, tt.name
    FROM tags tg
    LEFT JOIN tags_translations tt ON tt.tag_id=tg.id AND tt.language=?
    WHERE tg.deleted_at IS NULL
    ORDER BY COALESCE(tt.name,''), tg.id
  `, lang);

  const selectedCategoryIds = (await db.all(`SELECT category_id FROM posts_categories WHERE post_id=?`, id))
    .map(r => r.category_id);
  const selectedTagIds = (await db.all(`SELECT tag_id FROM posts_tags WHERE post_id=?`, id))
    .map(r => r.tag_id);

  const gallery = await db.all(`
    SELECT m.id, m.url
    FROM media_usages mu
    JOIN media m ON m.id = mu.media_id
    WHERE mu.post_id=? AND mu.field='gallery' AND (m.deleted_at IS NULL)
    ORDER BY mu.position, mu.media_id
  `, id);

  let featured = null;
  if (item && item.featured_media_id) {
    featured = await db.get(`SELECT id, url FROM media WHERE id=?`, item.featured_media_id);
  }

  res.render('posts/edit', {
    pageTitle: 'Edit Post',
    item,
    categories,
    tags,
    selectedCategoryIds,
    selectedTagIds,
    featured,
    gallery,
    lang,
    error: null
  });
});

router.post('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const id = Number(req.params.id);

  try {
    const {
      title, slug, status, display_date, scheduled_at,
      excerpt, content_html,
      primary_category_id,
      featured_media_id,
      tag_ids, category_ids,
      gallery_ids
    } = req.body;

    await db.exec('BEGIN');

    await db.run(`
      UPDATE posts
      SET status=?, display_date=?, scheduled_at=?, primary_category_id=?, featured_media_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, status || 'draft', display_date || null, scheduled_at || null,
       primary_category_id || null, featured_media_id || null,
       req.user.id, id);

    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    await db.run(`
      UPDATE posts_translations
      SET title=?, slug=?, excerpt=?, content_html=?
      WHERE post_id=? AND language=?
    `, title || '', theSlug, excerpt || '', cleanHtml(content_html || ''), id, lang);

    await db.run(`DELETE FROM posts_categories WHERE post_id=?`, id);
    const cats = Array.isArray(category_ids)
      ? category_ids
      : (category_ids ? String(category_ids).split(',') : []);
    for (const c of cats.filter(Boolean)) {
      await db.run(`INSERT OR IGNORE INTO posts_categories(post_id, category_id) VALUES(?,?)`, id, Number(c));
    }

    await db.run(`DELETE FROM posts_tags WHERE post_id=?`, id);
    const tags = Array.isArray(tag_ids)
      ? tag_ids
      : (tag_ids ? String(tag_ids).split(',') : []);
    for (const t of tags.filter(Boolean)) {
      await db.run(`INSERT OR IGNORE INTO posts_tags(post_id, tag_id) VALUES(?,?)`, id, Number(t));
    }

    await db.run(`DELETE FROM media_usages WHERE post_id=? AND field='gallery'`, id);
    const gal = Array.isArray(gallery_ids)
      ? gallery_ids
      : (gallery_ids ? String(gallery_ids).split(',') : []);
    let pos = 0;
    for (const mid of gal.filter(Boolean)) {
      await db.run(`
        INSERT INTO media_usages(post_id, media_id, field, position)
        VALUES(?, ?, 'gallery', ?)
      `, id, Number(mid), pos++);
    }

    await logActivity(req.user.id, 'update', 'post', id);
    await db.exec('COMMIT');
    return res.redirect('/admin/posts');
  } catch (e) {
    await db.exec('ROLLBACK');
    console.error(e);
    return res.status(500).send(e.message || String(e));
  }
});

/* =========================
 * SOFT DELETE
 * ========================= */
router.post('/:id/trash', requireRoles('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const db = await getDb();
  await db.run(`UPDATE posts SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL`, id);
  await logActivity(req.user.id, 'trash', 'post', id);
  res.redirect('/admin/posts');
});

export default router;
