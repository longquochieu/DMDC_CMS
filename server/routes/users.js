import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { requireAuth, requireRoles } from '../middlewares/auth.js';
import { getDb } from '../utils/db.js';
import { sanitizeSvg } from '../utils/sanitizeSvg.js';
import { logActivity } from '../services/logs.js';

const router = express.Router();

const AVATAR_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const uploadAvatar = multer({ limits: { fileSize: 2*1024*1024 } });

// Profile self
router.get('/me', requireAuth, async (req, res) => {
  const db = await getDb();
  const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
  res.render('users/profile', { pageTitle: 'Tài khoản', me, message: null, error: null });
});

router.post('/me', requireAuth, async (req, res) => {
  const db = await getDb();
  const { display_name, email } = req.body;
  try{
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email không hợp lệ');
    await db.run('UPDATE users SET display_name=?, email=? WHERE id=?', display_name||null, email.trim(), req.user.id);
    await logActivity(req.user.id, 'user.update_self', 'user', req.user.id, {});
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:'Đã lưu thông tin.', error:null });
  }catch(e){
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:null, error:e.message });
  }
});

router.post('/me/password', requireAuth, async (req, res) => {
  const db = await getDb();
  const { current_password, new_password, confirm_password } = req.body;
  try{
    if (!new_password || new_password.length<8) throw new Error('Mật khẩu mới tối thiểu 8 ký tự');
    if (new_password !== confirm_password) throw new Error('Xác nhận mật khẩu không khớp');
    const row = await db.get('SELECT password_hash FROM users WHERE id=?', req.user.id);
    const ok = await bcrypt.compare(current_password||'', row?.password_hash||'');
    if (!ok) throw new Error('Mật khẩu hiện tại không đúng');
    const hash = await bcrypt.hash(new_password, 10);
    await db.run('UPDATE users SET password_hash=?, session_version=session_version+1 WHERE id=?', hash, req.user.id);
    await logActivity(req.user.id, 'user.change_password', 'user', req.user.id, {});
    res.redirect('/admin/users/me?changed=1');
  }catch(e){
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:null, error:e.message });
  }
});

router.post('/me/avatar', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
  const db = await getDb();
  try{
    if (!req.file) throw new Error('Chưa chọn ảnh');
    const mime = req.file.mimetype;
    let filename, outPath;
    if (mime === 'image/svg+xml'){
      filename = `u${req.user.id}_${Date.now()}.svg`;
      outPath = path.join(AVATAR_DIR, filename);
      const cleaned = sanitizeSvg(req.file.buffer.toString('utf-8'));
      fs.writeFileSync(outPath, cleaned, 'utf-8');
    } else {
      filename = `u${req.user.id}_${Date.now()}.webp`;
      outPath = path.join(AVATAR_DIR, filename);
      await sharp(req.file.buffer).resize(512,512,{fit:'cover'}).toFormat('webp',{quality:82}).toFile(outPath);
    }
    const rel = `/uploads/avatars/${filename}`;
    await db.run('UPDATE users SET avatar_path=? WHERE id=?', rel, req.user.id);
    await logActivity(req.user.id, 'user.change_avatar', 'user', req.user.id, {});
    res.redirect('/admin/users/me?avatar=1');
  }catch(e){
    const me = await db.get('SELECT id, username, email, display_name, avatar_path FROM users WHERE id=?', req.user.id);
    res.render('users/profile', { pageTitle:'Tài khoản', me, message:null, error:e.message });
  }
});

router.post('/me/logout-all', requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run('UPDATE users SET session_version=session_version+1 WHERE id=?', req.user.id);
  await logActivity(req.user.id, 'user.logout_all', 'user', req.user.id, {});
  res.redirect('/login');
});

// Admin management
function adminOnly(req,res,next){
  if (!req.user || req.user.role !== 'admin') return res.status(403).send('Forbidden');
  next();
}

router.get('/', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const q = (req.query.q||'').trim();
  const role = (req.query.role||'').trim();
  const status = (req.query.status||'').trim();
  const params = [];
  let where = 'u.deleted_at IS NULL';   // đảm bảo trỏ đúng bảng users u
  if (q){ where += ' AND (username LIKE ? OR email LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }
  if (role){ where += ' AND role = ?'; params.push(role); }
  if (status){ where += ' AND status = ?'; params.push(status); }

  const rows = await db.all(`
    SELECT id, username, email, role, status, last_activity,
      CASE WHEN last_activity IS NOT NULL AND (strftime('%s','now') - strftime('%s',last_activity)) <= 300 THEN 1 ELSE 0 END AS last_activity_recent
    FROM users
    WHERE ${where}
    ORDER BY id DESC
    LIMIT 200
  `, params);
  res.render('users/list', { pageTitle:'Users', rows, q, role, status, message: req.query.message||null, error:null });
});

router.get('/new', requireAuth, adminOnly, async (req, res) => {
  res.render('users/form', { pageTitle:'New User', item:null, message:null, error:null });
});

router.post('/new', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const { username, email, display_name, role, status, password } = req.body;
  try{
    if (!username || !email || !password) throw new Error('Thiếu dữ liệu');
    const u1 = await db.get('SELECT 1 FROM users WHERE username=? AND deleted_at IS NULL', username.trim());
    if (u1) throw new Error('Username đã tồn tại');
    const u2 = await db.get('SELECT 1 FROM users WHERE email=? AND deleted_at IS NULL', email.trim());
    if (u2) throw new Error('Email đã tồn tại');
    const hash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users(username, email, display_name, role, status, password_hash, session_version) VALUES(?,?,?,?,?,?,1)',
      username.trim(), email.trim(), (display_name||null), role||'author', status||'active', hash);
    const idRow = await db.get('SELECT last_insert_rowid() AS id');
    await logActivity(req.user.id, 'user.create', 'user', idRow.id, { role, status });
    res.redirect('/admin/users?message=Created');
  }catch(e){
    res.render('users/form', { pageTitle:'New User', item:null, message:null, error:e.message });
  }
});

router.get('/:id/edit', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  const item = await db.get('SELECT id, username, email, display_name, role, status FROM users WHERE id=? AND deleted_at IS NULL', id);
  if (!item) return res.status(404).send('Not found');
  res.render('users/form', { pageTitle:'Edit User', item, message:null, error:null });
});

router.post('/:id/edit', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  const { email, display_name, role, status, password } = req.body;
  try{
    await db.run('UPDATE users SET email=?, display_name=?, role=?, status=? WHERE id=?', email.trim(), (display_name||null), role, status, id);
    if (password && password.length>=8){
      const hash = await bcrypt.hash(password, 10);
      await db.run('UPDATE users SET password_hash=?, session_version=session_version+1 WHERE id=?', hash, id);
      await logActivity(req.user.id, 'user.reset_password_admin', 'user', id, {});
    }
    await logActivity(req.user.id, 'user.update', 'user', id, { role, status });
    res.redirect('/admin/users?message=Saved');
  }catch(e){
    const item = await db.get('SELECT id, username, email, display_name, role, status FROM users WHERE id=?', id);
    res.render('users/form', { pageTitle:'Edit User', item, message:null, error:e.message });
  }
});

router.post('/:id/disable', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).send('Không thể vô hiệu hoá chính bạn');
  await db.run('UPDATE users SET status="disabled", session_version=session_version+1 WHERE id=?', id);
  await logActivity(req.user.id, 'user.disable', 'user', id, {});
  res.redirect('/admin/users?message=Disabled');
});

router.post('/:id/enable', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  await db.run('UPDATE users SET status="active" WHERE id=?', id);
  await logActivity(req.user.id, 'user.enable', 'user', id, {});
  res.redirect('/admin/users?message=Enabled');
});

router.post('/:id/delete', requireAuth, adminOnly, async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).send('Không thể xoá chính bạn');
  await db.run('UPDATE users SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', id);
  await logActivity(req.user.id, 'user.delete', 'user', id, {});
  res.redirect('/admin/users?message=Deleted');
});

export default router;
