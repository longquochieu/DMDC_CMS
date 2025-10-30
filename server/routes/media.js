// server/routes/media.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { getDb } from '../utils/db.js';
import { requireAuth } from '../middlewares/auth.js';

const router = express.Router();

// View index
router.get('/', requireAuth, (req, res) => {
  res.render('media/index', { pageTitle: 'Media' });
});

// JSON list
router.get('/list', requireAuth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, url, original_filename, mime as mime_type, size_bytes
     FROM media WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 200`
  );
  res.json({ items: rows });
});

// UPLOAD
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const y  = String(now.getFullYear());
    const m  = String(now.getMonth()+1).padStart(2,'0');
    const dir = path.join(UPLOAD_ROOT, y, m);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const base = path.parse(file.originalname).name
      .toLowerCase().replace(/[^a-z0-9\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    const stamp = Date.now();
    cb(null, `${base}-${stamp}${path.extname(file.originalname).toLowerCase()}`);
  }
});
const upload = multer({ storage });

router.post('/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const srcPath = req.file.path;
    let outPath = srcPath;
    let mime = req.file.mimetype;
    let size = req.file.size;
    let width = null, height = null;

    // Auto nén/convert -> webp nếu file > ngưỡng
    const maxMb = Number(process.env.MAX_IMAGE_SIZE_MB || 5);
    const big = size > maxMb * 1024 * 1024;

    const img = sharp(srcPath);
    const meta = await img.metadata();
    width = meta.width || null;
    height = meta.height || null;

    if (big || !/image\/(webp|png|jpeg|jpg|gif|svg\+xml)/i.test(mime)) {
      const parsed = path.parse(srcPath);
      outPath = path.join(parsed.dir, parsed.name + '.webp');
      await img.webp({ quality: 82 }).toFile(outPath);
      fs.unlinkSync(srcPath);
      mime = 'image/webp';
      size = fs.statSync(outPath).size;
    }

    // URL public
    const rel = path.relative(UPLOAD_ROOT, outPath).split(path.sep).join('/');
    const url = '/uploads/' + rel;

    // Lưu DB
    const db = await getDb();
    const r = await db.run(
      `INSERT INTO media(url, original_filename, mime, size_bytes, width, height)
       VALUES(?,?,?,?,?,?)`,
      url, req.file.originalname, mime, size, width, height
    );

    res.json({
      id: r.lastID, url,
      original_filename: req.file.originalname,
      mime_type: mime, size_bytes: size
    });
  } catch (e) { next(e); }
});

export default router;
