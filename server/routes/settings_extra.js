import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';

const router = express.Router();
const upload = multer({ limits: { fileSize: 5*1024*1024 } });

function setSetting(db, key, value){
  return db.run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
}

router.post('/branding', requireRoles('admin','editor'), upload.fields([{name:'site_logo'},{name:'site_favicon'}]), async (req, res) => {
  const db = await getDb();
  const updir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'branding');
  fs.mkdirSync(updir, { recursive: true });
  try{
    if (req.files?.site_logo?.[0]){
      const f = req.files.site_logo[0];
      const ext = path.extname(f.originalname).toLowerCase();
      const name = 'logo_'+Date.now()+ext;
      const p = path.join(updir, name);
      fs.writeFileSync(p, f.buffer);
      await setSetting(db, 'site_logo', '/uploads/branding/'+name);
    }
    if (req.files?.site_favicon?.[0]){
      const f = req.files.site_favicon[0];
      const ext = path.extname(f.originalname).toLowerCase();
      const name = 'favicon_'+Date.now()+ext;
      const p = path.join(updir, name);
      fs.writeFileSync(p, f.buffer);
      await setSetting(db, 'site_favicon', '/uploads/branding/'+name);
      try{
        const pngToIco = (await import('png-to-ico')).default;
        const icoBuf = await pngToIco(f.buffer);
        const iname = 'favicon_'+Date.now()+'.ico';
        fs.writeFileSync(path.join(updir, iname), icoBuf);
        await setSetting(db, 'site_favicon_ico', '/uploads/branding/'+iname);
      }catch(e){ /* optional */ }
    }
    res.redirect('/admin/settings?message=BrandingSaved');
  }catch(e){
    res.status(500).send(e.message);
  }
});

router.post('/seo', requireRoles('admin','editor'), async (req, res) => {
  const db = await getDb();
  const { ga4_measurement_id, gsc_meta_tag, max_image_size_mb, disk_alert_mb } = req.body;
  await setSetting(db, 'ga4_measurement_id', (ga4_measurement_id||'').trim());
  await setSetting(db, 'gsc_meta_tag', (gsc_meta_tag||'').trim());
  await setSetting(db, 'max_image_size_mb', String(parseInt(max_image_size_mb||5,10)||5));
  await setSetting(db, 'disk_alert_mb', String(parseInt(disk_alert_mb||500,10)||500));
  res.redirect('/admin/settings?message=SeoSaved');
});

export default router;
