
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { requireAuth } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { sanitizeSvg } from '../utils/sanitizeSvg.js';

const router = express.Router();

// Storage for avatar (use uploads/avatars/)
const AVATAR_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|svg\+xml)/.test(file.mimetype);
    if (!ok) return cb(new Error('Định dạng không hỗ trợ. Chỉ jpg/png/webp/svg.'));
    cb(null, true);
  }
});

// GET profile
router.get('/me', requireAuth, async (req, res) => {
  const db = await getDb();
  const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
  res.render('users/profile', { pageTitle: 'Tài khoản', me, message: null, error: null });
});

// POST update profile (display_name, email)
router.post('/me', requireAuth, async (req, res) => {
  const db = await getDb();
  const { display_name, email } = req.body;
  try{
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email không hợp lệ');
    await db.run('UPDATE users SET display_name=?, email=? WHERE id=?', display_name || null, email.trim(), req.user.id);
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:'Đã lưu thông tin.', error:null });
  }catch(e){
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:null, error:e.message });
  }
});

// POST change password
router.post('/me/password', requireAuth, async (req, res) => {
  const db = await getDb();
  const { current_password, new_password, confirm_password } = req.body;
  try{
    if (!new_password || new_password.length < 8) throw new Error('Mật khẩu mới tối thiểu 8 ký tự');
    if (new_password !== confirm_password) throw new Error('Xác nhận mật khẩu không khớp');
    const user = await db.get('SELECT password_hash FROM users WHERE id=?', req.user.id);
    const ok = await bcrypt.compare(current_password || '', user.password_hash || '');
    if (!ok) throw new Error('Mật khẩu hiện tại không đúng');
    const hash = await bcrypt.hash(new_password, 10);
    await db.run('UPDATE users SET password_hash=?, session_version = session_version + 1 WHERE id=?', hash, req.user.id);
    // bump session_version => đăng xuất tất cả thiết bị khác
    res.redirect('/admin/users/me?changed=1');
  }catch(e){
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:null, error:e.message });
  }
});

// POST upload avatar
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  const db = await getDb();
  try{
    if (!req.file) throw new Error('Chưa chọn ảnh');
    const ext = req.file.mimetype === 'image/svg+xml' ? '.svg' : '.webp';
    const filename = `u${req.user.id}_${Date.now()}${ext}`;
    const outPath = path.join(AVATAR_DIR, filename);

    if (ext === '.svg') {
      const cleaned = sanitizeSvg(req.file.buffer.toString('utf-8'));
      fs.writeFileSync(outPath, cleaned, 'utf-8');
    } else {
      // Convert to WEBP, max 512x512
      await sharp(req.file.buffer).resize(512, 512, { fit: 'cover' }).toFormat('webp', { quality: 82 }).toFile(outPath);
    }
    const rel = `/uploads/avatars/${filename}`;
    await db.run('UPDATE users SET avatar_path=? WHERE id=?', rel, req.user.id);
    res.redirect('/admin/users/me?avatar=1');
  }catch(e){
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:null, error:e.message });
  }
});

// POST logout all sessions (bump session_version)
router.post('/me/logout-all', requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run('UPDATE users SET session_version = session_version + 1 WHERE id=?', req.user.id);
  res.redirect('/login'); // phiên hiện tại cũng sẽ bị out do middleware check
});

export default router;
