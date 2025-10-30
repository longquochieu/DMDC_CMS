import express from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../utils/db.js';

const router = express.Router();

// Form login GET giữ nguyên...
router.get('/login', (req, res) => {
  res.render('login', { pageTitle: 'Đăng nhập', error: null });
});

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body; // "login" là ID đăng nhập hoặc Email
    if (!login || !password) {
      return res.status(400).render('login', { pageTitle: 'Đăng nhập', error: 'Thiếu thông tin đăng nhập' });
    }

    const db = await getDb();
    // tìm theo username hoặc email (không phân biệt hoa thường), chỉ lấy user active, chưa xóa
    const user = await db.get(`
      SELECT id, username, email, role, status, password_hash, session_version
      FROM users
      WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?))
        AND (deleted_at IS NULL) AND status = 'active'
      LIMIT 1
    `, login, login);

    if (!user) {
      // không tiết lộ lý do -> trả 401
      return res.status(401).render('login', { pageTitle: 'Đăng nhập', error: 'Sai tài khoản hoặc mật khẩu' });
    }

    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      return res.status(401).render('login', { pageTitle: 'Đăng nhập', error: 'Sai tài khoản hoặc mật khẩu' });
    }

    // Đăng nhập thành công
    req.session.user_id = user.id;
    // tăng session_version đã xử lý ở middleware enforceSessionVersion; không cần ở đây
    return res.redirect('/admin');
  } catch (e) {
    console.error('[login]', e);
    return res.status(500).render('login', { pageTitle: 'Đăng nhập', error: 'Lỗi hệ thống' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
