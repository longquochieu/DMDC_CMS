import express from 'express';
import fs from 'fs';
import path from 'path';
import { requireRoles } from '../middlewares/auth.js';

const router = express.Router();

router.get('/', requireRoles('admin','editor'), (req, res) => {
  const logPath = path.resolve(process.env.LOG_DIR || './logs', 'error.log');
  let text = '';
  try{
    text = fs.readFileSync(logPath, 'utf8');
    const lines = text.trim().split('\n');
    text = lines.slice(-200).join('\n');
  }catch(e){
    text = '(No logs)';
  }
  res.render('logs/index', { pageTitle:'Error Logs', text });
});

router.post('/clear', requireRoles('admin','editor'), (req, res) => {
  const logPath = path.resolve(process.env.LOG_DIR || './logs', 'error.log');
  try{ fs.writeFileSync(logPath, ''); }catch(e){}
  res.redirect('/admin/logs');
});

export default router;
