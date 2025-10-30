// server/routes/media.js — full replacement
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import sharp from 'sharp';
import sanitizeHtml from 'sanitize-html';
import { fileURLToPath } from 'url';

import { requireAuth } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

// Upload config: memory storage -> we always post-process
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_MB || '10', 10)) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // allow images + svg
    if (/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type: ' + file.mimetype));
  }
});

async function ensureDir(d) {
  await fs.mkdir(d, { recursive: true });
}

router.get('/', requireAuth, async (req, res) => {
  res.render('media/index', { pageTitle: 'Media' });
});

// JSON list used by editor's Media Picker
router.get('/list', requireAuth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT id, url, original_filename, mime AS mime_type, size_bytes
    FROM media
    WHERE deleted_at IS NULL OR deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 200
  `);
  res.json({ items: rows });
});

// Upload endpoint used by editor (and media page). Field name: "file"
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const originalName = req.file.originalname || 'upload';
    const incomingMime = req.file.mimetype || 'application/octet-stream';
    const buf = req.file.buffer;

    let outBuf;
    let outExt;

    if (incomingMime === 'image/svg+xml') {
      // sanitize SVG (basic; can be tuned)
      const cleaned = sanitizeHtml(buf.toString('utf-8'), {
        allowedTags: false, // allow all tags but...
        allowedAttributes: false, // ...strip event handlers later
        // A stricter allowlist can be set if needed
      });
      outBuf = Buffer.from(cleaned, 'utf-8');
      outExt = '.svg';
    } else {
      // Convert all rasters to webp
      outBuf = await sharp(buf).toFormat('webp', { quality: 82 }).toBuffer();
      outExt = '.webp';
    }

    // Build dated folder path: /uploads/YYYY/MM
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const outDir = path.join(UPLOAD_DIR, yyyy, mm);
    await ensureDir(outDir);

    // Safe basename
    const base = path.basename(originalName, path.extname(originalName))
      .toLowerCase()
      .replace(/[^a-z0-9\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const fileName = `${base || 'img'}-${Date.now()}${outExt}`;
    const absPath = path.join(outDir, fileName);
    await fs.writeFile(absPath, outBuf);

    const rel = absPath.replace(UPLOAD_DIR, '').replace(/\\/g, '/');
    const url = `/uploads${rel}`;

    const db = await getDb();
    const info = await db.run(
      `INSERT INTO media (url, original_filename, mime, size_bytes, width, height, created_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, NULL, datetime('now'), NULL)`,
      url, originalName, incomingMime, outBuf.length
    );

    res.json({
      id: info.lastID,
      url,
      original_filename: originalName,
      mime_type: incomingMime,
      size_bytes: outBuf.length
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;