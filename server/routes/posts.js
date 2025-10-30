import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import sanitizeHtml from 'sanitize-html';
import { getCategoriesTree } from '../services/tree.js';
import { logActivity } from '../services/logs.js';

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

router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const sort = (req.query.sort||'created');
  const dir  = (req.query.dir||'desc').toLowerCase()==='asc'?'asc':'desc';
  let order = 'p.id DESC';
  if (sort==='title') order = `t.title ${dir}`;
  else if (sort==='published') order = `p.display_date ${dir}`;
  else order = `p.id ${dir}`;
  const lang = await getSetting('default_language','vi');
  const rows = await db.all(`
    SELECT p.id, p.status, p.display_date, p.featured_media_id,
      (SELECT url FROM media WHERE id=p.featured_media_id) AS featured_url,
      t.title, t.slug,
      (SELECT group_concat(ct.name, ', ') FROM posts_categories pc
         JOIN categories_translations ct ON ct.category_id=pc.category_id AND ct.language=?
       WHERE pc.post_id=p.id) AS categories,
      (SELECT group_concat(tt.name, ', ') FROM posts_tags pt
         JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=?
       WHERE pt.post_id=p.id) AS tags,
      u.username AS author
    FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.deleted_at IS NULL
    ORDER BY ${order}
    LIMIT 300
  `, lang, lang, lang);
  res.render('posts/list', { pageTitle:'Posts', rows, sort, dir });
});

router.get('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const lang = await getSetting('default_language','vi');
  const categoriesTree = await getCategoriesTree(lang);
  res.render('posts/edit', { pageTitle:'New Post', item:null, error:null, categoriesTree, selectedCategoryIds: [], primaryCategoryId: null, selectedTags: [], galleryMedia: [] });
});

router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  try{
    let { title, slug, excerpt, status, content_html, display_date, scheduled_at, primary_category_id, category_ids, tags_csv, featured_media_id, gallery_media_ids } = req.body;
    const userId = req.user.id;
    await db.run('INSERT INTO posts(status, display_date, scheduled_at, created_by, updated_by, featured_media_id) VALUES(?,?,?,?,?,?)',
      status||'draft', display_date||new Date().toISOString(), scheduled_at||null, userId, userId, featured_media_id||null);
    const idrow = await db.get('SELECT last_insert_rowid() as id'); const postId = idrow.id;
    const baseSlug = (slug && slug.trim()) ? toSlug(slug) : toSlug(title);
    await db.run('INSERT INTO posts_translations(post_id, language, title, slug, excerpt, content_html) VALUES(?,?,?,?,?,?)',
      postId, lang, title, baseSlug, (excerpt||''), cleanHtml(content_html||''));
    const dup = await db.get('SELECT COUNT(*) AS c FROM posts_translations WHERE language=? AND slug=? AND post_id<>?', lang, baseSlug, postId);
    if (dup.c > 0){
      const fixed = baseSlug + '-' + postId;
      await db.run('UPDATE posts_translations SET slug=? WHERE post_id=? AND language=?', fixed, postId, lang);
    }
    primary_category_id = primary_category_id ? Number(primary_category_id) : null;
    await db.run('UPDATE posts SET primary_category_id=? WHERE id=?', primary_category_id, postId);
    const catIds = Array.isArray(category_ids) ? category_ids.map(Number) : (category_ids ? [Number(category_ids)] : []);
    for (const cid of catIds){ await db.run('INSERT INTO posts_categories(post_id, category_id) VALUES(?,?)', postId, cid); }
    const tagNames = (tags_csv||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,10);
    for (const name of tagNames){
      let tag = await db.get('SELECT t.id FROM tags t JOIN tags_translations tt ON tt.tag_id=t.id AND tt.language=? WHERE tt.name=?', lang, name);
      if (!tag){
        await db.run('INSERT INTO tags DEFAULT VALUES');
        const r = await db.get('SELECT last_insert_rowid() as id');
        await db.run('INSERT INTO tags_translations(tag_id, language, name, slug) VALUES(?,?,?,?)', r.id, lang, name, toSlug(name));
        tag = { id: r.id };
      }
      await db.run('INSERT INTO posts_tags(post_id, tag_id) VALUES(?,?)', postId, tag.id);
    }
    const galleryIds = Array.isArray(gallery_media_ids) ? gallery_media_ids.map(Number) : (gallery_media_ids ? [Number(gallery_media_ids)] : []);
    for (let i=0;i<galleryIds.length;i++){
      await db.run('INSERT INTO media_usages(post_id, media_id, field, position) VALUES(?,?,?,?)', postId, galleryIds[i], 'gallery', i);
    }
    const urls = (content_html||'').match(/<img[^>]+src=["']([^"']+)["']/ig) || [];
    for (const tag of urls){
      const m = /src=["']([^"']+)["']/.exec(tag);
      if (m){
        const media = await db.get('SELECT id FROM media WHERE url=?', m[1]);
        if (media){ await db.run('INSERT INTO media_usages(post_id, media_id, field) VALUES(?,?,?)', postId, media.id, 'content_html'); }
      }
    }
    await logActivity(userId, 'post.create', 'post', postId, { status });
    res.redirect('/admin/posts');
  }catch(e){
    const categoriesTree = await getCategoriesTree(lang);
    res.render('posts/edit', { pageTitle:'New Post', item:null, error:e.message, categoriesTree, selectedCategoryIds: [], primaryCategoryId: null, selectedTags: [], galleryMedia: [], gallery: [], lang });
  }
});

router.get('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  const item = await db.get(`SELECT p.*, t.title, t.slug, t.excerpt, t.content_html,
    (SELECT url FROM media WHERE id=p.featured_media_id) AS featured_url
    FROM posts p LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=? WHERE p.id=?`, lang, id);
  if (item){
    item.display_date_local = (item.display_date? (new Date(item.display_date).toISOString().slice(0,16)) : '');
    item.scheduled_at_local = (item.scheduled_at? (new Date(item.scheduled_at).toISOString().slice(0,16)) : '');
  }
  const categoriesTree = await getCategoriesTree(lang);
  const cats = await db.all('SELECT category_id FROM posts_categories WHERE post_id=?', id);
  const selectedCategoryIds = cats.map(x=>x.category_id);
  const prim = await db.get('SELECT primary_category_id FROM posts WHERE id=?', id);
  const primaryCategoryId = prim ? prim.primary_category_id : null;
  const tags = await db.all('SELECT tt.name FROM posts_tags pt JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=? WHERE pt.post_id=?', lang, id);
  const selectedTags = tags.map(x=>x.name);
  const galleryMedia = await db.all('SELECT m.id, m.url FROM media_usages mu JOIN media m ON m.id=mu.media_id WHERE mu.post_id=? AND mu.field="gallery" ORDER BY mu.position, m.id', id);
    const gallery = await db.all(`
	  SELECT m.id, m.url
	  FROM media_usages mu
	  JOIN media m ON m.id = mu.media_id
	  WHERE mu.post_id = ? AND mu.field = 'gallery' AND mu.deleted_at IS NULL
	  ORDER BY mu.position, m.id
	`, id);
	res.render('posts/edit', { pageTitle:'Edit Post', item, error:null, categoriesTree, selectedCategoryIds, primaryCategoryId, selectedTags, galleryMedia, featured, gallery: gallery || [], lang });
});

router.post('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  try{
    let { title, slug, excerpt, status, content_html, display_date, scheduled_at, primary_category_id, category_ids, tags_csv, featured_media_id, gallery_media_ids } = req.body;
    await db.run('UPDATE posts SET status=?, display_date=?, scheduled_at=?, updated_by=?, updated_at=CURRENT_TIMESTAMP, featured_media_id=? WHERE id=?',
      status||'draft', display_date||null, scheduled_at||null, req.user.id, featured_media_id||null, id);
    const baseSlug = (slug && slug.trim()) ? toSlug(slug) : toSlug(title);
    await db.run('UPDATE posts_translations SET title=?, slug=?, excerpt=?, content_html=? WHERE post_id=? AND language=?',
      title, baseSlug, (excerpt||''), cleanHtml(content_html||''), id, lang);
    const dup = await db.get('SELECT COUNT(*) AS c FROM posts_translations WHERE language=? AND slug=? AND post_id<>?', lang, baseSlug, id);
    if (dup.c > 0){
      const fixed = baseSlug + '-' + id;
      await db.run('UPDATE posts_translations SET slug=? WHERE post_id=? AND language=?', fixed, id, lang);
    }
    primary_category_id = primary_category_id ? Number(primary_category_id) : null;
    await db.run('UPDATE posts SET primary_category_id=? WHERE id=?', primary_category_id, id);
    await db.run('DELETE FROM posts_categories WHERE post_id=?', id);
    const catIds2 = Array.isArray(category_ids) ? category_ids.map(Number) : (category_ids ? [Number(category_ids)] : []);
    for (const cid of catIds2){ await db.run('INSERT INTO posts_categories(post_id, category_id) VALUES(?,?)', id, cid); }
    await db.run('DELETE FROM posts_tags WHERE post_id=?', id);
    const tagNames2 = (tags_csv||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,10);
    for (const name of tagNames2){
      let tag = await db.get('SELECT t.id FROM tags t JOIN tags_translations tt ON tt.tag_id=t.id AND tt.language=? WHERE tt.name=?', lang, name);
      if (!tag){
        await db.run('INSERT INTO tags DEFAULT VALUES');
        const r = await db.get('SELECT last_insert_rowid() as id');
        await db.run('INSERT INTO tags_translations(tag_id, language, name, slug) VALUES(?,?,?,?)', r.id, lang, name, toSlug(name));
        tag = { id: r.id };
      }
      await db.run('INSERT INTO posts_tags(post_id, tag_id) VALUES(?,?)', id, tag.id);
    }
    await db.run('DELETE FROM media_usages WHERE post_id=? AND field="gallery"', id);
    const galleryIds = Array.isArray(gallery_media_ids) ? gallery_media_ids.map(Number) : (gallery_media_ids ? [Number(gallery_media_ids)] : []);
    for (let i=0;i<galleryIds.length;i++){
      await db.run('INSERT INTO media_usages(post_id, media_id, field, position) VALUES(?,?,?,?)', id, galleryIds[i], 'gallery', i);
    }
    await db.run('DELETE FROM media_usages WHERE post_id=? AND field="content_html"', id);
    const urls2 = (content_html||'').match(/<img[^>]+src=["']([^"']+)["']/ig) || [];
    for (const tag of urls2){
      const m = /src=["']([^"']+)["']/.exec(tag);
      if (m){
        const media = await db.get('SELECT id FROM media WHERE url=?', m[1]);
        if (media){ await db.run('INSERT INTO media_usages(post_id, media_id, field) VALUES(?,?,?)', id, media.id, 'content_html'); }
      }
    }
    await logActivity(req.user.id, 'post.update', 'post', id, { status });
    res.redirect('/admin/posts');
  }catch(e){
    const categoriesTree = await getCategoriesTree(lang);
    const cats = await db.all('SELECT category_id FROM posts_categories WHERE post_id=?', id);
    const selectedCategoryIds = cats.map(x=>x.category_id);
    const prim = await db.get('SELECT primary_category_id FROM posts WHERE id=?', id);
    const primaryCategoryId = prim ? prim.primary_category_id : null;
    const tags = await db.all('SELECT tt.name FROM posts_tags pt JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=? WHERE pt.post_id=?', lang, id);
    const selectedTags = tags.map(x=>x.name);
    const item = await db.get(`SELECT p.*, t.title, t.slug, t.excerpt, t.content_html,
      (SELECT url FROM media WHERE id=p.featured_media_id) AS featured_url
      FROM posts p LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=? WHERE p.id=?`, lang, id);
    const galleryMedia = await db.all('SELECT m.id, m.url FROM media_usages mu JOIN media m ON m.id=mu.media_id WHERE mu.post_id=? AND mu.field="gallery" ORDER BY mu.position, m.id', id);
    res.render('posts/edit', { pageTitle:'Edit Post', item, error:e.message, categoriesTree, selectedCategoryIds, primaryCategoryId, selectedTags, galleryMedia });
  }
});

router.post('/:id/trash', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  await db.run('UPDATE posts SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', id);
  await logActivity(req.user.id, 'post.trash', 'post', id, {});
  res.redirect('/admin/posts');
});

export default router;
