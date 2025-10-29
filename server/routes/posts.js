
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import sanitizeHtml from 'sanitize-html';
import { getCategoriesTree } from '../services/tree.js';

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

function extractImageUrls(html){
  if (!html) return [];
  const out = [];
  const re = /<img[^>]+src=["']([^"']+)["']/ig;
  let m; while ((m=re.exec(html))){ out.push(m[1]); }
  return out;
}

// LIST
router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const rows = await db.all(`SELECT p.id, p.status, t.title, t.slug
    FROM posts p LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=?
    WHERE p.deleted_at IS NULL ORDER BY p.id DESC LIMIT 200`, lang);
  res.render('posts/list', { pageTitle:'Posts', rows, lang });
});

// NEW
router.get('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const lang = await getSetting('default_language','vi');
  const categoriesTree = await getCategoriesTree(lang);
  res.render('posts/edit', { pageTitle:'New Post', item:null, error:null, categoriesTree, selectedCategoryIds: [], primaryCategoryId: null, selectedTags: [] });
});

router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  try{
    let { title, slug, status, content_html, display_date, scheduled_at, primary_category_id, category_ids, tags_csv } = req.body;
    await db.run('INSERT INTO posts(status,display_date,scheduled_at,created_by,updated_by) VALUES(?,?,?,?,?)',
      status||'draft', display_date||null, scheduled_at||null, req.user.id, req.user.id);
    const idrow = await db.get('SELECT last_insert_rowid() as id'); const postId = idrow.id;
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    await db.run('INSERT INTO posts_translations(post_id,language,title,slug,content_html) VALUES(?,?,?,?,?)', postId, lang, title, theSlug, cleanHtml(content_html||''));
    primary_category_id = primary_category_id ? Number(primary_category_id) : null;
    await db.run('UPDATE posts SET primary_category_id=? WHERE id=?', primary_category_id, postId);
    const catIds = Array.isArray(category_ids) ? category_ids.map(Number) : (category_ids ? [Number(category_ids)] : []);
    for (const cid of catIds){ await db.run('INSERT INTO posts_categories(post_id, category_id) VALUES(?,?)', postId, cid); }
    const tagNames = (tags_csv||'').split(',').map(s=>s.trim()).filter(Boolean);
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
    const urls = extractImageUrls(content_html||'');
    for (const u of urls){ const m = await db.get('SELECT id FROM media WHERE url=?', u); if(m){ await db.run('INSERT INTO media_usages(post_id, media_id, field) VALUES(?,?,?)', postId, m.id, 'content_html'); } }
    res.redirect('/admin/posts');
  }catch(e){
    const categoriesTree = await getCategoriesTree(lang);
    res.render('posts/edit', { pageTitle:'New Post', item:null, error:e.message, categoriesTree, selectedCategoryIds: [], primaryCategoryId: null, selectedTags: [] });
  }
});

// EDIT
router.get('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  const item = await db.get(`SELECT p.*, t.title, t.slug, t.content_html FROM posts p
    LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=? WHERE p.id=?`, lang, id);
  const categoriesTree = await getCategoriesTree(lang);
  const cats = await db.all('SELECT category_id FROM posts_categories WHERE post_id=?', id);
  const selectedCategoryIds = cats.map(x=>x.category_id);
  const prim = await db.get('SELECT primary_category_id FROM posts WHERE id=?', id);
  const primaryCategoryId = prim ? prim.primary_category_id : null;
  const tags = await db.all('SELECT tt.name FROM posts_tags pt JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=? WHERE pt.post_id=?', lang, id);
  const selectedTags = tags.map(x=>x.name);
  res.render('posts/edit', { pageTitle:'Edit Post', item, error:null, categoriesTree, selectedCategoryIds, primaryCategoryId, selectedTags });
});

router.post('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');
  try{
    let { title, slug, status, content_html, display_date, scheduled_at, primary_category_id, category_ids, tags_csv } = req.body;
    await db.run('UPDATE posts SET status=?, display_date=?, scheduled_at=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      status||'draft', display_date||null, scheduled_at||null, req.user.id, id);
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    await db.run('UPDATE posts_translations SET title=?, slug=?, content_html=? WHERE post_id=? AND language=?',
      title, theSlug, cleanHtml(content_html||''), id, lang);

    primary_category_id = primary_category_id ? Number(primary_category_id) : null;
    await db.run('UPDATE posts SET primary_category_id=? WHERE id=?', primary_category_id, id);
    await db.run('DELETE FROM posts_categories WHERE post_id=?', id);
    const catIds2 = Array.isArray(category_ids) ? category_ids.map(Number) : (category_ids ? [Number(category_ids)] : []);
    for (const cid of catIds2){ await db.run('INSERT INTO posts_categories(post_id, category_id) VALUES(?,?)', id, cid); }
    await db.run('DELETE FROM posts_tags WHERE post_id=?', id);
    const tagNames2 = (tags_csv||'').split(',').map(s=>s.trim()).filter(Boolean);
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
    await db.run('DELETE FROM media_usages WHERE post_id=?', id);
    const urls2 = extractImageUrls(content_html||'');
    for (const u of urls2){ const m = await db.get('SELECT id FROM media WHERE url=?', u); if(m){ await db.run('INSERT INTO media_usages(post_id, media_id, field) VALUES(?,?,?)', id, m.id, 'content_html'); } }

    res.redirect('/admin/posts');
  }catch(e){
    const categoriesTree = await getCategoriesTree(lang);
    const cats = await db.all('SELECT category_id FROM posts_categories WHERE post_id=?', id);
    const selectedCategoryIds = cats.map(x=>x.category_id);
    const prim = await db.get('SELECT primary_category_id FROM posts WHERE id=?', id);
    const primaryCategoryId = prim ? prim.primary_category_id : null;
    const tags = await db.all('SELECT tt.name FROM posts_tags pt JOIN tags_translations tt ON tt.tag_id=pt.tag_id AND tt.language=? WHERE pt.post_id=?', lang, id);
    const selectedTags = tags.map(x=>x.name);
    const item = await db.get(`SELECT p.*, t.title, t.slug, t.content_html FROM posts p
      LEFT JOIN posts_translations t ON t.post_id=p.id AND t.language=? WHERE p.id=?`, lang, id);
    res.render('posts/edit', { pageTitle:'Edit Post', item, error:e.message, categoriesTree, selectedCategoryIds, primaryCategoryId, selectedTags });
  }
});

export default router;
