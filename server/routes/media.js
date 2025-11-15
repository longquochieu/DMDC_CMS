// server/routes/media.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { getDb } from '../utils/db.js';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { sanitizeSvg } from '../utils/sanitizeSvg.js';

const router = express.Router();

// --- Paths & helpers ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function yyyymm(d = new Date()) { return [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')]; }

const IMAGE_MIME_WHITELIST = new Set(['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']);
const DOC_MIME_WHITELIST = new Set(['application/pdf']);
const VIDEO_MIME_WHITELIST = new Set(['video/mp4','video/webm']);

// quick magic sniff
async function sniffMagic(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 4).toString() === '%PDF') return 'application/pdf';
  return null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const [y, m] = yyyymm();
    const dir = path.join(UPLOAD_ROOT, y, m);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const base = path.parse(file.originalname).name
      .toLowerCase().replace(/[^a-z0-9\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// ---------- VIEWS ----------
router.get('/', requireAuth, (req, res) => {
  res.render('media/index', { pageTitle: 'Media', csrfToken: req.csrfToken() });
});

// ---------- LIST API ----------
router.get('/list', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(
      1,
      Math.min(100, Number(req.query.page_size || 24))
    );
    const offset = (page - 1) * pageSize;

    const q = (req.query.q || '').trim();
    const type = (req.query.type || '').trim(); // image|video|doc|'' (all)
    const folderId = req.query.folder_id ?? null;

    let where = 'm.deleted_at IS NULL';
    const params = [];

    if (q) {
      where += ' AND (m.filename LIKE ? OR m.original_name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    if (type === 'image') where += ' AND m.mime_type LIKE "image/%"';
    else if (type === 'video') where += ' AND m.mime_type LIKE "video/%"';
    else if (type === 'doc') where += ' AND m.mime_type = "application/pdf"';

    let join = '';
    if (folderId && folderId !== 'uncategorized') {
      join = 'LEFT JOIN media_folder_items mfi ON mfi.media_id = m.id';
      where += ' AND mfi.folder_id = ?';
      params.push(Number(folderId));
    } else if (folderId === 'uncategorized') {
      where +=
        ' AND NOT EXISTS (SELECT 1 FROM media_folder_items t WHERE t.media_id=m.id)';
    }

    const sort = req.query.sort || 'created_at';
    const allowedSort = new Set([
      'created_at',
      'filename',
      'size_bytes',
      'mime_type',
    ]);
    const orderBy = allowedSort.has(sort) ? sort : 'created_at';
    const dir =
      String(req.query.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const totalRow = await db.get(
      `SELECT COUNT(*) AS cnt FROM media m ${join} WHERE ${where}`,
      params
    );

    // ⚠️ Không dùng placeholder cho LIMIT/OFFSET
    const listSql = `
      SELECT m.id, m.url, m.filename, m.original_name, m.mime_type, m.size_bytes, m.width, m.height, m.created_at
      FROM media m
      ${join}
      WHERE ${where}
      ORDER BY ${orderBy} ${dir}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const rows = await db.all(listSql, params);

    res.json({
      ok: true,
      rows,
      total: totalRow?.cnt || 0,
      page,
      page_size: pageSize,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ---------- BULK API ----------
router.post('/bulk', requireRoles('admin','editor'), async (req, res, next) => {
  try {
    const db = await getDb();
    const { action, ids = [], folder_id, exclusive } = req.body || {};
    const idList = (Array.isArray(ids) ? ids : []).map(n => Number(n)).filter(Boolean);
    if (!idList.length) return res.status(400).json({ ok: false, error: 'Chưa chọn mục nào' });

    if (action === 'trash') {
      await db.run(`UPDATE media SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${idList.map(()=>'?').join(',')})`, idList);
    } else if (action === 'delete') {
      await db.run(`DELETE FROM media WHERE id IN (${idList.map(()=>'?').join(',')})`, idList);
    } else if (action === 'assign') {
      if (!folder_id) return res.status(400).json({ ok:false, error:'Thiếu folder_id' });
      await db.exec('START TRANSACTION');
      try {
        if (exclusive) {
          await db.run(`DELETE FROM media_folder_items WHERE media_id IN (${idList.map(()=>'?').join(',')})`, idList);
        }
        for (const mid of idList) {
          await db.run(`INSERT IGNORE INTO media_folder_items(folder_id, media_id) VALUES(?,?)`, [Number(folder_id), Number(mid)]);
        }
        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        return res.status(500).json({ ok: false, error: err.message || String(err) });
      }
    } else if (action === 'unassign') {
      if (!folder_id) return res.status(400).json({ ok:false, error:'Thiếu folder_id' });
      await db.run(`DELETE FROM media_folder_items WHERE folder_id=? AND media_id IN (${idList.map(()=>'?').join(',')})`, [Number(folder_id), ...idList]);
    } else {
      return res.status(400).json({ ok:false, error:'Action không hợp lệ' });
    }
    res.json({ ok: true });
  } catch (e) {
    try { const db = await getDb(); await db.exec('ROLLBACK'); } catch {}
    next(e);
  }
});

// ---------- UPLOAD ----------
router.post('/upload', requireRoles('admin','editor'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'Thiếu file' });

    let mime = await sniffMagic(req.file.path) || req.file.mimetype || '';
    const isImage = mime.startsWith('image/');
    const isSvg = mime === 'image/svg+xml' || path.extname(req.file.originalname).toLowerCase() === '.svg';
    const isDoc = DOC_MIME_WHITELIST.has(mime);
    const isVideo = VIDEO_MIME_WHITELIST.has(mime);

    if (!(isImage || isDoc || isVideo || isSvg)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ ok:false, error:'Định dạng không được phép' });
    }

    let finalPath = req.file.path;
    let finalUrl  = finalPath.replace(path.resolve(UPLOAD_ROOT), '').split(path.sep).join('/');
    finalUrl = '/uploads' + finalUrl;

    let width = null, height = null;
    let size = fs.statSync(finalPath).size;

    if (isSvg) {
      const txt = fs.readFileSync(finalPath, 'utf8');
      fs.writeFileSync(finalPath, sanitizeSvg(txt), 'utf8');
      mime = 'image/svg+xml';
    } else if (isImage && mime !== 'image/svg+xml') {
      try {
        const meta = await sharp(finalPath).metadata();
        width = meta.width || null; height = meta.height || null;
        if (size > 200 * 1024 && mime !== 'image/webp') {
          const outPath = finalPath.replace(/\.[a-z0-9]+$/i, '.webp');
          await sharp(finalPath).webp({ quality: 82 }).toFile(outPath);
          fs.unlinkSync(finalPath);
          finalPath = outPath;
          finalUrl  = finalUrl.replace(/\.[a-z0-9]+$/i, '.webp');
          mime = 'image/webp';
          size = fs.statSync(finalPath).size;
        }
        const parts = finalUrl.replace('/uploads/','').split('/'); // [YYYY,MM,filename]
        const thumbDir = path.join(UPLOAD_ROOT, '_thumbs', parts[0] || '', parts[1] || '');
        ensureDir(thumbDir);
        const thumbPath = path.join(thumbDir, path.basename(finalPath).replace(/\.[a-z0-9]+$/i, '.jpg'));
        await sharp(finalPath).resize({ width: 300 }).jpeg({ quality: 80 }).toFile(thumbPath);
      } catch {}
    }

    const db = await getDb();
    const filenameOnly = path.basename(finalPath);

    // Thử insert có updated_at; nếu DB chưa có cột -> fallback insert không updated_at
    try {
      await db.run(
        `INSERT INTO media(filename, url, original_name, mime_type, size_bytes, width, height, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [filenameOnly, finalUrl, req.file.originalname, mime, size, width, height]
      );
    } catch (err) {
      if (String(err.message || '').includes("Unknown column 'updated_at'")) {
        await db.run(
          `INSERT INTO media(filename, url, original_name, mime_type, size_bytes, width, height, created_at)
           VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
          [filenameOnly, finalUrl, req.file.originalname, mime, size, width, height]
        );
      } else {
        throw err;
      }
    }

    const idRow = await db.get(`SELECT last_insert_rowid() AS id`);
    const id = idRow?.id || null;

    res.json({
      ok: true,
      id,
      url: finalUrl,
      filename: filenameOnly,
      original_name: req.file.originalname,
      original_filename: req.file.originalname,
      mime_type: mime,
      size_bytes: size,
      width, height
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

export default router;
