// server/routes/pages.js
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';
import { toSlug } from '../utils/strings.js';
import sanitizeHtml from 'sanitize-html';
import { rebuildPageSubtreeFullPaths } from '../services/rebuild.js';
import { buildFullPathForPage } from '../services/hierarchy.js';
import { logActivity } from '../services/activity.js';
import { getPagesTree } from '../services/tree.js';
import { getSeo, saveSeo, getSeoDefaults } from '../services/seo.js';

const router = express.Router();
const TEMPLATES = ['default','landing','contact'];

/* ================= MySQL-safe: kiểm tra cột tồn tại ================= */
async function hasColumn(db, tableName, columnName) {
  // db tham số để giữ API cũ, nhưng bản thân câu query dùng DATABASE() của MySQL
  const row = await db.get(
    `
    SELECT 1 AS ok
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
      AND COLUMN_NAME  = ?
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return !!row?.ok;
}

/* ================ HTML sanitizer cho nội dung page ================ */
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

/** ======================= LIST ======================= */
router.get("/", requireAuth, async (req, res) => {
  const db   = await getDb();
  const lang = await getSetting("default_language", "vi");

  // kiểm tra xem pages có cột parent_id không
  const hasParentId = await hasColumn(db, "pages", "parent_id");

  // sort & dir (giữ nguyên cơ bản)
  const allowedSort = new Set(["title", "status", "created_at", "updated_at"]);
  const sort = allowedSort.has(req.query.sort) ? req.query.sort : "created_at";
  const dir  = (req.query.dir === "asc") ? "asc" : "desc";

  const sortMap = {
    title: "t.title",
    status: "p.status",
    created_at: "p.created_at",
    updated_at: "p.updated_at"
  };
  const orderBy = sortMap[sort] || "p.created_at";

  // build SELECT linh hoạt
  const baseSelect = `
    SELECT
      p.id,
      p.status,
      p.created_by,
      p.created_at,
      p.updated_at,
      t.title,
      t.slug
  `;

  const parentSelect = hasParentId
    ? `,
      p.parent_id,
      pt.title AS parent_title
    `
    : `,
      NULL AS parent_id,
      NULL AS parent_title
    `;

  const fromJoin = `
    FROM pages p
    LEFT JOIN pages_translations t
      ON t.page_id = p.id AND t.language = ?
  `;

  const parentJoin = hasParentId
    ? `
    LEFT JOIN pages p2
      ON p2.id = p.parent_id
    LEFT JOIN pages_translations pt
      ON pt.page_id = p2.id AND pt.language = ?
    `
    : ``;

  const sql = `
    ${baseSelect}
    ${parentSelect}
    ${fromJoin}
    ${parentJoin}
    WHERE p.deleted_at IS NULL
    ORDER BY ${orderBy} ${dir}
    LIMIT 500
  `;

  const params = hasParentId ? [lang, lang] : [lang];

  const rows = await db.all(sql, params);

  res.render("pages/list", {
    pageTitle: "Trang",
    rows,
    sort,
    dir
  });
});

/** ======================= TREE ======================= */
router.get('/tree', requireAuth, async (req, res) => {
  const lang = await getSetting('default_language','vi');
  const tree = await getPagesTree(lang);
  res.render('pages/tree', { pageTitle: 'Cây Pages (Drag & Drop)', tree, lang });
});

/** ======================= NEW (form) ======================= */
router.get('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const parents = await db.all(`
    SELECT p.id, t.title
    FROM pages p
    LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
    WHERE p.deleted_at IS NULL
    ORDER BY t.title
  `, lang);

  const seoDefaults = await getSeoDefaults();
  const seo = {
    title: "",
    meta_description: "",
    focus_keyword: "",
    robots_index: seoDefaults.seo_default_index || "index",
    robots_follow: seoDefaults.seo_default_follow || "follow",
    robots_advanced: "",
    canonical_url: "",
    schema_type: seoDefaults.seo_schema_default_type || "",
    schema_jsonld: seoDefaults.seo_schema_default_jsonld || "",
    og_title: "",
    og_description: "",
    og_image_url: "",
    twitter_title: "",
    twitter_description: "",
    twitter_image_url: "",
  };

  res.render('pages/edit', { pageTitle:'New Page', item:null, parents, lang, error:null, templates: TEMPLATES, seo, seoDefaults });
});

/** ======================= NEW (submit) ======================= */
router.post('/new', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');

  try{
    const { title, slug, status, parent_id, content_html, order_index, template, featured_media_id } = req.body;
    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);

    await db.run(
      `INSERT INTO pages(status,parent_id,order_index,created_by,updated_by,template,featured_media_id)
       VALUES(?,?,?,?,?,?,?)`,
      [ status||'draft',
        parent_id||null,
        Number(order_index||0),
        req.user.id,
        req.user.id,
        template || null,
        featured_media_id ? Number(featured_media_id) : null
      ]
    );

    // MySQL: LAST_INSERT_ID()
    const idRow = await db.get('SELECT LAST_INSERT_ID() AS id');

    await db.run(
      'INSERT INTO pages_translations(page_id,language,title,slug,content_html) VALUES(?,?,?,?,?)',
      [ idRow.id, lang, title, theSlug, cleanHtml(content_html||'') ]
    );

    const full = await buildFullPathForPage(idRow.id, lang);
    await db.run('UPDATE pages_translations SET full_path=? WHERE page_id=? AND language=?', [full, idRow.id, lang]);

    // --- SAVE SEO ---
    const seoPayload = {
      title: req.body.seo_title || "",
      meta_description: req.body.seo_description || "",
      focus_keyword: req.body.seo_focus_keyword || "",
      robots_index: req.body.seo_robots_index || "",
      robots_follow: req.body.seo_robots_follow || "",
      robots_advanced: req.body.seo_robots_advanced || "",
      canonical_url: req.body.seo_canonical_url || "",
      schema_type: req.body.seo_schema_type || "",
      schema_jsonld: req.body.seo_schema_jsonld || "",
      og_title: req.body.seo_og_title || "",
      og_description: req.body.seo_og_description || "",
      og_image_url: req.body.seo_og_image_url || "",
      twitter_title: req.body.seo_twitter_title || "",
      twitter_description: req.body.seo_twitter_description || "",
      twitter_image_url: req.body.seo_twitter_image_url || "",
    };
    await saveSeo("page", idRow.id, lang, seoPayload);
    // ---------------

    await logActivity(req.user.id, 'create', 'page', idRow.id);
    res.redirect('/admin/pages');
  }catch(e){
    const parents = await db.all(`
      SELECT p.id, t.title
      FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
      WHERE p.deleted_at IS NULL ORDER BY t.title
    `, lang);
    const seoDefaults = await getSeoDefaults();
    res.render('pages/edit', {
      pageTitle:'New Page',
      item:null,
      parents,
      lang,
      error:e.message,
      templates: TEMPLATES,
      seo: {
        title: req.body.seo_title || "",
        meta_description: req.body.seo_description || "",
        focus_keyword: req.body.seo_focus_keyword || "",
        robots_index: req.body.seo_robots_index || "",
        robots_follow: req.body.seo_robots_follow || "",
        robots_advanced: req.body.seo_robots_advanced || "",
        canonical_url: req.body.seo_canonical_url || "",
        schema_type: req.body.seo_schema_type || "",
        schema_jsonld: req.body.seo_schema_jsonld || "",
        og_title: req.body.seo_og_title || "",
        og_description: req.body.seo_og_description || "",
        og_image_url: req.body.seo_og_image_url || "",
        twitter_title: req.body.seo_twitter_title || "",
        twitter_description: req.body.seo_twitter_description || "",
        twitter_image_url: req.body.seo_twitter_image_url || "",
      },
      seoDefaults
    });
  }
});

/** ======================= EDIT (form) ======================= */
router.get('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const lang = await getSetting('default_language','vi');

  const parents = await db.all(
    `SELECT p.id, t.title
     FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
     WHERE p.deleted_at IS NULL AND p.id <> ?
     ORDER BY t.title`, [lang, id]
  );

  const item = await db.get(`
    SELECT p.*, t.title, t.slug, t.full_path, t.content_html,
           (SELECT m.url FROM media m WHERE m.id = p.featured_media_id) AS featured_media_url
    FROM pages p
    LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
    WHERE p.id=?`, [lang, id]
  );

  const seo = await getSeo("page", Number(id), lang);
  const seoDefaults = await getSeoDefaults();

  res.render('pages/edit', { pageTitle:'Edit Page', item, parents, lang, error:null, templates: TEMPLATES, seo, seoDefaults });
});

/** ======================= EDIT (submit) ======================= */
router.post('/:id/edit', requireRoles('admin','editor','author','contributor'), async (req, res) => {
  const db = await getDb();
  const lang = await getSetting('default_language','vi');
  const id = req.params.id;

  try{
    const { title, slug, status, parent_id, content_html, order_index, template, featured_media_id } = req.body;

    await db.run(
      `UPDATE pages SET parent_id=?, status=?, order_index=?, updated_by=?, updated_at=CURRENT_TIMESTAMP,
                        template=?, featured_media_id=?
       WHERE id=?`,
      [ parent_id || null,
        status || 'draft',
        Number(order_index||0),
        req.user.id,
        template || null,
        (featured_media_id ? Number(featured_media_id) : null),
        id
      ]
    );

    const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(title);
    await db.run(
      'UPDATE pages_translations SET title=?, slug=?, content_html=? WHERE page_id=? AND language=?',
      [ title, theSlug, cleanHtml(content_html||''), id, lang ]
    );

    const full = await buildFullPathForPage(id, lang);
    await db.run('UPDATE pages_translations SET full_path=? WHERE page_id=? AND language=?', [full, id, lang]);

    // --- SAVE SEO ---
    const seoPayload = {
      title: req.body.seo_title || "",
      meta_description: req.body.seo_description || "",
      focus_keyword: req.body.seo_focus_keyword || "",
      robots_index: req.body.seo_robots_index || "",
      robots_follow: req.body.seo_robots_follow || "",
      robots_advanced: req.body.seo_robots_advanced || "",
      canonical_url: req.body.seo_canonical_url || "",
      schema_type: req.body.seo_schema_type || "",
      schema_jsonld: req.body.seo_schema_jsonld || "",
      og_title: req.body.seo_og_title || "",
      og_description: req.body.seo_og_description || "",
      og_image_url: req.body.seo_og_image_url || "",
      twitter_title: req.body.seo_twitter_title || "",
      twitter_description: req.body.seo_twitter_description || "",
      twitter_image_url: req.body.seo_twitter_image_url || "",
    };
    await saveSeo("page", Number(id), lang, seoPayload);
    // ---------------

    await logActivity(req.user.id, 'update', 'page', id);
    res.redirect('/admin/pages');
  }catch(e){
    const parents = await db.all(
      `SELECT p.id, t.title
       FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
       WHERE p.deleted_at IS NULL AND p.id <> ?
       ORDER BY t.title`, [lang, id]
    );
    const seo = await getSeo("page", Number(id), lang).catch(() => ({}));
    const seoDefaults = await getSeoDefaults();

    const item = await db.get(`
      SELECT p.*, t.title, t.slug, t.full_path, t.content_html,
            (SELECT m.url FROM media m WHERE m.id = p.featured_media_id) AS featured_media_url
      FROM pages p
      LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=?
      WHERE p.id=?`, [lang, id]
    );

    res.render('pages/edit', { pageTitle:'Edit Page', item, parents, lang, error:e.message, templates: TEMPLATES, seo, seoDefaults });
  }
});

/** ======================= REORDER (drag-drop) ======================= */
router.post('/reorder', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  let { node_id, new_parent_id, new_index, lang } = req.body;

  try {
    node_id = Number(node_id);
    const newIdx   = Number(new_index ?? 0);
    const parentId = (new_parent_id === '' || new_parent_id == null) ? null : Number(new_parent_id);
    const langUse  = lang || 'vi';

    // MySQL transaction
    await db.run('START TRANSACTION');

    if (parentId != null) {
      const stack = [parentId];
      while (stack.length) {
        const x = stack.pop();
        if (Number(x) === node_id) throw new Error('Không thể đặt làm con của chính nó.');
        const kids = await db.all('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL', [x]);
        for (const c of kids) stack.push(c.id);
      }
    }

    await db.run('UPDATE pages SET parent_id = ? WHERE id = ?', [parentId, node_id]);

    let siblings = [];
    if (parentId == null) {
      siblings = await db.all(
        'SELECT id FROM pages WHERE parent_id IS NULL AND deleted_at IS NULL AND id <> ? ORDER BY order_index, id',
        [node_id]
      );
    } else {
      siblings = await db.all(
        'SELECT id FROM pages WHERE parent_id = ? AND deleted_at IS NULL AND id <> ? ORDER BY order_index, id',
        [parentId, node_id]
      );
    }

    const ordered = siblings.map(s => s.id);
    const insertAt = Math.max(0, Math.min(newIdx, ordered.length));
    ordered.splice(insertAt, 0, node_id);

    for (let i = 0; i < ordered.length; i++) {
      await db.run('UPDATE pages SET order_index = ? WHERE id = ?', [i, ordered[i]]);
    }

    const updated_paths = await rebuildPageSubtreeFullPaths(node_id, langUse);

    await db.run('COMMIT');
    res.json({ ok: true, updated_paths });
  } catch (e) {
    try { await db.run('ROLLBACK'); } catch {}
    res.status(409).json({ ok: false, error: e.message || String(e) });
  }
});

/** ======================= TRASH / RESTORE ======================= */
router.post('/:id/trash', requireRoles('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = await getDb();

  const row = await db.get('SELECT id, is_home FROM pages WHERE id=? AND deleted_at IS NULL', [id]);
  if (!row) return res.redirect('/admin/pages?err=not_found');
  if (row.is_home === 1) return res.redirect('/admin/pages?err=cannot_delete_home');

  const child = await db.get('SELECT 1 AS c FROM pages WHERE parent_id=? AND deleted_at IS NULL LIMIT 1', [id]);
  if (child?.c) return res.redirect('/admin/pages?err=has_children');

  // MySQL: NOW()
  await db.run('UPDATE pages SET deleted_at = NOW() WHERE id=?', [id]);

  if (req.flash) req.flash('success', 'Đã chuyển Page vào Trash.');
  await logActivity(req.user.id, 'trash', 'page', id);
  return res.redirect('/admin/pages');
});

router.post('/:id/restore', requireRoles('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = await getDb();
  const row = await db.get('SELECT id FROM pages WHERE id=? AND deleted_at IS NOT NULL', [id]);
  if (!row) return res.redirect('/admin/trash?err=not_in_trash');
  await db.run('UPDATE pages SET deleted_at = NULL WHERE id=?', [id]);
  await logActivity(req.user.id, 'restore', 'page', id);
  return res.redirect('/admin/trash?ok=restored');
});

export default router;
