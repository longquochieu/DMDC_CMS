// server/routes/posts.js
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import sanitizeHtml from 'sanitize-html';

const router = express.Router();

function cleanHtml(input) {
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
      iframe(tagName, attribs) {
        try {
          const url = new URL(attribs.src||'', 'http://x');
          const host = url.hostname.replace(/^www\./,'');
          if (!['youtube.com','youtu.be'].includes(host) && host.indexOf('youtube.com')===-1) {
            return { tagName:'p', text:'' };
          }
        } catch { return { tagName:'p', text:'' }; }
        attribs.referrerpolicy = 'strict-origin-when-cross-origin';
        attribs.allow = attribs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        return { tagName:'iframe', attribs };
      }
    }
  };
  return sanitizeHtml(input||'', cfg);
}

const ALLOWED_STATUS = ['draft', 'pending', 'scheduled', 'published'];
const canUserSchedule = (user) => ['admin','editor'].includes(user?.role);

function ensureStatus(inputStatus, canSchedule) {
  const s = (inputStatus || '').toLowerCase();
  if (!ALLOWED_STATUS.includes(s)) return 'draft';
  if (s === 'scheduled' && !canSchedule) return 'pending';
  return s;
}

function mustFuture(dtStr) {
  if (!dtStr) return false;
  const t = new Date(dtStr);
  if (isNaN(t.getTime())) return false;
  return t.getTime() > Date.now();
}

function buildCategoryTree(rows) {
  const map = new Map();
  rows.forEach(r => {
    const k = r.parent_id ?? 0;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ id:r.id, parent_id:r.parent_id, name:r.name });
  });
  const sort = arr => (arr||[]).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  function walk(pid=0, depth=0) {
    return sort(map.get(pid)).map(n => ({ ...n, depth, children: walk(n.id, depth+1) }));
  }
  return walk(0,0);
}
function flatten(tree, out=[]) {
  tree.forEach(n => { out.push({ id:n.id, name:n.name, depth:n.depth }); if (n.children?.length) flatten(n.children,out); });
  return out;
}

// ===== List =====
router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const sort = ['title','created_at','status','slug'].includes(req.query.sort) ? req.query.sort : 'created_at';
  const dir  = req.query.dir === 'asc' ? 'asc' : 'desc';

  const posts = await db.all(`
    SELECT p.id, p.status, p.created_at,
           t.title, t.slug,
           u.username AS author,
           m.url AS thumb
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN media m ON m.id = p.featured_media_id
    WHERE p.deleted_at IS NULL
    ORDER BY ${sort === 'title' ? 't.title' : sort === 'slug' ? 't.slug' : 'p.'+sort} ${dir}
    LIMIT 500
  `, lang);

  const catRows = await db.all(`
    SELECT pc.post_id, GROUP_CONCAT(ct.name, ', ') cats
    FROM posts_categories pc
    LEFT JOIN categories_translations ct ON ct.category_id=pc.category_id AND ct.language=?
    GROUP BY pc.post_id
  `, lang);
  const catsByPost = new Map(catRows.map(r => [r.post_id, r.cats || '']));

  const tagRows = await db.all(`
    SELECT pt.post_id, GROUP_CONCAT(tt.name, ', ') tags
    FROM posts_tags pt
    LEFT JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=?
    GROUP BY pt.post_id
  `, lang);
  const tagsByPost = new Map(tagRows.map(r => [r.post_id, r.tags || '']));

  const items = posts.map(p => ({ ...p, categories: catsByPost.get(p.id)||'', tags: tagsByPost.get(p.id)||'' }));

  res.render('posts/list', { pageTitle:'Bài viết', items, sort, dir });
});

// ===== New =====
router.get('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const cats = await db.all(`
    SELECT c.id, c.parent_id, ct.name
    FROM categories c
    LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
    WHERE c.deleted_at IS NULL
  `, lang);
  const tree = flatten(buildCategoryTree(cats));
  res.render('posts/edit', {
    pageTitle:'Tạo bài viết mới',
    item:null,
    categories:tree,
    selectedCategoryIds:[],
    primaryCategoryId:null,
    tags:[],
    featured:null,
    gallery:[],
    perms:{ canSchedule: canUserSchedule(req.user) },
    error:null,
    warn:null
  });
});

router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const canSchedule = canUserSchedule(req.user);

  // --- Unpack form ---
  const {
    title, slug, content_html,
    status, display_date, scheduled_at,
    tags = '',
    featured_media_id = null,
  } = req.body;

  const catIds = Array.isArray(req.body.category_ids) ? req.body.category_ids
                : (req.body.category_ids ? [req.body.category_ids] : []);
  let primary_category_id = req.body.primary_category_id || null;

  // --- Validations ---
  let error = null, warn = null;
  if (!catIds.length) {
    error = 'Bạn chưa chọn danh mục, vui lòng chọn.';
  }
  if (!error && catIds.length > 1 && !primary_category_id) {
    // Tự chọn danh mục chính = ID lớn nhất trong danh mục đã chọn
    const maxId = String(Math.max(...catIds.map(x => Number(x))));
    primary_category_id = maxId;
    warn = `Bạn chưa chọn danh mục chính, hệ thống tự chọn danh mục có ID ${maxId} làm danh mục chính.`;
  }
  const safeStatus = ensureStatus(status, canSchedule);
  if (!error && safeStatus === 'scheduled') {
    if (!mustFuture(scheduled_at)) error = 'Vui lòng chọn thời điểm đăng trong tương lai cho trạng thái Lên lịch.';
  }
  if (error) {
    const cats = await db.all(`
      SELECT c.id, c.parent_id, ct.name
      FROM categories c
      LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
      WHERE c.deleted_at IS NULL
    `, lang);
    const tree = flatten(buildCategoryTree(cats));
    return res.status(422).render('posts/edit', {
      pageTitle:'Tạo bài viết mới',
      item:{ title, slug, content_html, status, display_date, scheduled_at, created_at:new Date().toISOString() },
      categories:tree,
      selectedCategoryIds: catIds.map(String),
      primaryCategoryId: primary_category_id ? String(primary_category_id) : null,
      tags: (tags||'').split(',').map(s=>s.trim()).filter(Boolean),
      featured:null, gallery:[],
      perms:{ canSchedule },
      error, warn
    });
  }

  try {
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    await db.run(`
      INSERT INTO posts(status, display_date, scheduled_at, featured_media_id, primary_category_id, created_by, updated_by)
      VALUES(?,?,?,?,?,?,?)
    `, safeStatus, display_date || null, (safeStatus==='scheduled' ? (scheduled_at||null) : null),
       featured_media_id || null, (primary_category_id || null), req.user.id, req.user.id);

    const { id } = await db.get(`SELECT last_insert_rowid() AS id`);
    await db.run(`
      INSERT INTO posts_translations(post_id, language, title, slug, excerpt, content_html)
      VALUES(?,?,?,?,?,?)
    `, id, lang, title, theSlug, '', cleanHtml(content_html||''));

    for (const cid of catIds) {
      await db.run(`INSERT OR IGNORE INTO posts_categories(post_id, category_id) VALUES(?,?)`, id, cid);
    }

    // Tags
    const tagNames = (tags||'').split(',').map(t=>t.trim()).filter(Boolean);
    for (const name of tagNames) {
      let tag = await db.get(`SELECT t.id FROM tags t JOIN tags_translations tt ON tt.tag_id=t.id AND tt.language=? WHERE tt.name=?`, lang, name);
      if (!tag) {
        await db.run(`INSERT INTO tags DEFAULT VALUES`);
        const { id: tagId } = await db.get(`SELECT last_insert_rowid() AS id`);
        await db.run(`INSERT INTO tags_translations(tag_id, language, name, slug) VALUES(?,?,?,?)`, tagId, lang, name, toSlug(name));
        tag = { id: tagId };
      }
      await db.run(`INSERT OR IGNORE INTO posts_tags(post_id, tag_id) VALUES(?,?)`, id, tag.id);
    }

    res.redirect('/admin/posts');
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

// ===== Edit =====
router.get('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');

  const item = await db.get(`
    SELECT p.*, t.title, t.slug, t.content_html
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    WHERE p.id=?
  `, lang, id);
  if (!item) return res.status(404).send('Không tìm thấy bài viết');

  const cats = await db.all(`
    SELECT c.id, c.parent_id, ct.name
    FROM categories c
    LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
    WHERE c.deleted_at IS NULL
  `, lang);
  const tree = flatten(buildCategoryTree(cats));

  const selected = await db.all(`SELECT category_id FROM posts_categories WHERE post_id=?`, id);
  const selectedCategoryIds = selected.map(r => String(r.category_id));

  const tagRows = await db.all(`
    SELECT tt.name
    FROM posts_tags pt
    JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=?
    WHERE pt.post_id=?
  `, lang, id);

  const featured = await db.get(`SELECT m.id, m.url FROM media m WHERE m.id=?`, item.featured_media_id || -1);

  const gallery = await db.all(`
    SELECT m.id, m.url
    FROM media_usages mu JOIN media m ON m.id=mu.media_id
    WHERE mu.post_id=? AND mu.field='gallery'
    ORDER BY mu.position ASC, mu.media_id ASC
  `, id);

  res.render('posts/edit', {
    pageTitle:`Sửa bài viết #${id}`,
    item,
    categories:tree,
    selectedCategoryIds,
    primaryCategoryId: item.primary_category_id ? String(item.primary_category_id) : null,
    tags: tagRows.map(r=>r.name),
    featured, gallery,
    perms:{ canSchedule: canUserSchedule(req.user) },
    error:null, warn:null
  });
});

router.post('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  const canSchedule = canUserSchedule(req.user);

  const {
    title, slug, content_html,
    status, display_date, scheduled_at,
    tags = '',
    featured_media_id = null
  } = req.body;

  const catIds = Array.isArray(req.body.category_ids) ? req.body.category_ids
                : (req.body.category_ids ? [req.body.category_ids] : []);
  let primary_category_id = req.body.primary_category_id || null;

  let error = null, warn = null;
  if (!catIds.length) {
    error = 'Bạn chưa chọn danh mục, vui lòng chọn.';
  }
  if (!error && catIds.length > 1 && !primary_category_id) {
    const maxId = String(Math.max(...catIds.map(x => Number(x))));
    primary_category_id = maxId;
    warn = `Bạn chưa chọn danh mục chính, hệ thống tự chọn danh mục có ID ${maxId} làm danh mục chính.`;
  }
  const safeStatus = ensureStatus(status, canSchedule);
  if (!error && safeStatus === 'scheduled') {
    if (!mustFuture(scheduled_at)) error = 'Vui lòng chọn thời điểm đăng trong tương lai cho trạng thái Lên lịch.';
  }

  if (error) {
    // Re-render
    const item = await db.get(`
      SELECT p.*, t.title, t.slug, t.content_html
      FROM posts p
      LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
      WHERE p.id=?
    `, lang, id);

    const cats = await db.all(`
      SELECT c.id, c.parent_id, ct.name
      FROM categories c
      LEFT JOIN categories_translations ct ON ct.category_id=c.id AND ct.language=?
      WHERE c.deleted_at IS NULL
    `, lang);
    const tree = flatten(buildCategoryTree(cats));

    return res.status(422).render('posts/edit', {
      pageTitle:`Sửa bài viết #${id}`,
      item:{ ...item, title, slug, content_html, status, display_date, scheduled_at },
      categories:tree,
      selectedCategoryIds: catIds.map(String),
      primaryCategoryId: primary_category_id ? String(primary_category_id) : null,
      tags: (tags||'').split(',').map(s=>s.trim()).filter(Boolean),
      featured: await db.get(`SELECT m.id, m.url FROM media m WHERE m.id=?`, featured_media_id || -1),
      gallery: await db.all(`
        SELECT m.id, m.url
        FROM media_usages mu JOIN media m ON m.id=mu.media_id
        WHERE mu.post_id=? AND mu.field='gallery'
        ORDER BY mu.position ASC, mu.media_id ASC
      `, id),
      perms:{ canSchedule },
      error, warn
    });
  }

  try {
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    await db.run(`
      UPDATE posts
      SET status=?, display_date=?, scheduled_at=?, featured_media_id=?, primary_category_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, safeStatus, display_date || null, (safeStatus==='scheduled' ? (scheduled_at||null) : null),
       featured_media_id || null, (primary_category_id || null), req.user.id, id);

    await db.run(`
      UPDATE posts_translations SET title=?, slug=?, content_html=?
      WHERE post_id=? AND language=?
    `, title, theSlug, cleanHtml(content_html||''), id, lang);

    // categories
    await db.run(`DELETE FROM posts_categories WHERE post_id=?`, id);
    for (const cid of catIds) {
      await db.run(`INSERT OR IGNORE INTO posts_categories(post_id, category_id) VALUES(?,?)`, id, cid);
    }

    // tags
    await db.run(`DELETE FROM posts_tags WHERE post_id=?`, id);
    const tagNames = (tags||'').split(',').map(t=>t.trim()).filter(Boolean);
    for (const name of tagNames) {
      let tag = await db.get(`SELECT t.id FROM tags t JOIN tags_translations tt ON tt.tag_id=t.id AND tt.language=? WHERE tt.name=?`, lang, name);
      if (!tag) {
        await db.run(`INSERT INTO tags DEFAULT VALUES`);
        const { id: tagId } = await db.get(`SELECT last_insert_rowid() AS id`);
        await db.run(`INSERT INTO tags_translations(tag_id, language, name, slug) VALUES(?,?,?,?)`, tagId, lang, name, toSlug(name));
        tag = { id: tagId };
      }
      await db.run(`INSERT OR IGNORE INTO posts_tags(post_id, tag_id) VALUES(?,?)`, id, tag.id);
    }

    res.redirect('/admin/posts');
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

export default router;
