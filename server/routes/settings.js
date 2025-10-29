import express from 'express';
import { requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { getAllSettings, setSetting, getSetting } from '../services/settings.js';

const router = express.Router();

router.get('/', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const s = await getAllSettings();
  const lang = await getSetting('default_language','vi');
  const pages = await db.all('SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL ORDER BY t.title', lang);
  res.render('settings/index', { pageTitle:'Settings', s, pages, success:null, error:null });
});

router.post('/', requireRoles('admin','editor'), async (req, res) => {
  try{
    await setSetting('site_title', req.body.site_title || '');
    await setSetting('admin_email', req.body.admin_email || '');
    await setSetting('timezone', req.body.timezone || 'Asia/Ho_Chi_Minh');
    await setSetting('date_format', req.body.date_format || 'd/m/Y');
    await setSetting('time_format', req.body.time_format || 'H:i');
    await setSetting('i18n_url_mode', req.body.i18n_url_mode || 'path');
    if (req.body.homepage_page_id) await setSetting('homepage_page_id', req.body.homepage_page_id);
    const s = await getAllSettings();
    const db = await getDb();
    const lang = await getSetting('default_language','vi');
    const pages = await db.all('SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL ORDER BY t.title', lang);
    res.render('settings/index', { pageTitle:'Settings', s, pages, success:'Đã lưu cài đặt.', error:null });
  }catch(e){
    const s = await getAllSettings();
    const db = await getDb();
    const lang = await getSetting('default_language','vi');
    const pages = await db.all('SELECT p.id, t.title FROM pages p LEFT JOIN pages_translations t ON t.page_id=p.id AND t.language=? WHERE p.deleted_at IS NULL ORDER BY t.title', lang);
    res.render('settings/index', { pageTitle:'Settings', s, pages, success:null, error:e.message });
  }
});

export default router;
