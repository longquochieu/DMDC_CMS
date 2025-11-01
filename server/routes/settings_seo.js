// server/routes/settings_seo.js
import express from 'express';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';

const router = express.Router();

async function upsertSetting(db, key, value) {
  // Yêu cầu settings.key UNIQUE
  await db.run(
    `INSERT INTO settings(key, value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    key, value ?? ''
  );
}

router.get('/', requireAuth, async (req, res) => {
  const read = async (k, d='') => await getSetting(k, d);
  const ctx = {
    seo_site_name:              await read('seo_site_name', await read('site_name','DMDC CMS')),
    seo_title_separator:        await read('seo_title_separator','-'),
    seo_default_index:          await read('seo_default_index','index'),
    seo_default_follow:         await read('seo_default_follow','follow'),
    seo_default_robots_advanced:await read('seo_default_robots_advanced',''),
    seo_default_og_image:       await read('seo_default_og_image',''),
    seo_template_post_title:    await read('seo_template_post_title','%title% %sep% %sitename%'),
    seo_template_page_title:    await read('seo_template_page_title','%title% %sep% %sitename%'),
    seo_template_category_title:await read('seo_template_category_title','%title% %sep% %sitename%'),
    seo_template_post_desc:     await read('seo_template_post_desc',''),
    seo_template_page_desc:     await read('seo_template_page_desc',''),
    seo_template_category_desc: await read('seo_template_category_desc','')
  };

  res.render('settings/seo', {
    pageTitle: 'Cài đặt SEO',
    ...ctx,
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || '')
  });
});

router.post('/', requireRoles('admin','editor'), express.urlencoded({extended:true}), async (req, res) => {
  const db = await getDb();
  const b  = req.body || {};
  await upsertSetting(db,'seo_site_name', b.seo_site_name);
  await upsertSetting(db,'seo_title_separator', b.seo_title_separator);
  await upsertSetting(db,'seo_default_index', b.seo_default_index);
  await upsertSetting(db,'seo_default_follow', b.seo_default_follow);
  await upsertSetting(db,'seo_default_robots_advanced', b.seo_default_robots_advanced);
  await upsertSetting(db,'seo_default_og_image', b.seo_default_og_image);
  await upsertSetting(db,'seo_template_post_title', b.seo_template_post_title);
  await upsertSetting(db,'seo_template_page_title', b.seo_template_page_title);
  await upsertSetting(db,'seo_template_category_title', b.seo_template_category_title);
  await upsertSetting(db,'seo_template_post_desc', b.seo_template_post_desc);
  await upsertSetting(db,'seo_template_page_desc', b.seo_template_page_desc);
  await upsertSetting(db,'seo_template_category_desc', b.seo_template_category_desc);

  res.redirect('/admin/settings/seo?ok=1');
});

export default router;
