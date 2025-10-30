import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import path from 'path';
import fs from 'fs';
import { getDb } from '../utils/db.js';
import { getSetting } from '../services/settings.js';

const router = express.Router();

function folderSizeMB(dir){
  try{
    let total = 0;
    const stack = [dir];
    while(stack.length){
      const d = stack.pop();
      if (!fs.existsSync(d)) continue;
      const items = fs.readdirSync(d);
      for (const name of items){
        const p = path.join(d, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) stack.push(p);
        else total += st.size;
      }
    }
    return Math.round(total/1024/1024);
  }catch{ return 0; }
}

router.get('/', requireAuth, async (req, res) => {
  const db = await getDb();
  const stats = {
    posts: (await db.get('SELECT COUNT(*) c FROM posts WHERE deleted_at IS NULL')).c,
    pages: (await db.get('SELECT COUNT(*) c FROM pages WHERE deleted_at IS NULL')).c,
    media: (await db.get('SELECT COUNT(*) c FROM media WHERE deleted_at IS NULL')).c,
    users: (await db.get('SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL')).c
  };
  const scheduled = await db.all(`SELECT t.title, p.scheduled_at FROM posts p LEFT JOIN posts_translations t ON t.post_id=p.id WHERE p.scheduled_at IS NOT NULL ORDER BY p.scheduled_at ASC LIMIT 10`);
  const recent = await db.all(`SELECT t.title, p.status, p.updated_at FROM posts p LEFT JOIN posts_translations t ON t.post_id=p.id WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 10`);
  const logs = await db.all('SELECT actor_id, action, entity_type, entity_id, created_at FROM activity_logs ORDER BY id DESC LIMIT 10');
  const uploadsDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const uploads_mb = folderSizeMB(uploadsDir);
  const dbFile = path.resolve(process.env.DB_FILE || './data/app.db');
  const db_mb = fs.existsSync(dbFile) ? Math.round(fs.statSync(dbFile).size/1024/1024) : 0;
  const disk_alert_mb = parseInt(await getSetting('disk_alert_mb','500'),10) || 500;
  const settings = { ga4_measurement_id: await getSetting('ga4_measurement_id','') };
  res.render('dashboard', { pageTitle:'Dashboard', stats, scheduled, recent, logs, settings, sys: { uploads_mb, db_mb, alert: (uploads_mb+db_mb) >= disk_alert_mb } });
});

export default router;
