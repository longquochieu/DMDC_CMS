
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { sanitizeSvg } from '../utils/sanitizeSvg.js';

const router = express.Router();

// ... existing list/view handlers

// JSON list for picker
router.get('/list', requireAuth, async (req, res) => {
  const db = await getDb();
  const q = (req.query.q||'').trim();
  let rows;
  if (q) rows = await db.all('SELECT * FROM media WHERE deleted_at IS NULL AND original_filename LIKE ? ORDER BY created_at DESC LIMIT 200', '%'+q+'%');
  else rows = await db.all('SELECT * FROM media WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200');
  res.json({ items: rows });
});

// Upload endpoint should return JSON when Accept is json
// NOTE: Keep your existing upload logic; ensure at the end you do:
/*
 if ((req.headers.accept||'').includes('application/json')) {
   return res.json({ ok:true, url });
 } else {
   return res.redirect('/admin/media');
 }
*/

export default router;
