import express from 'express';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import { csrfProtection } from '../middlewares/csrf.js';
import { getDb } from '../utils/db.js';
import { authRateLimiter } from '../middlewares/rateLimit.js';

const router = express.Router();
const SQLiteStore = SQLiteStoreFactory(session);

router.get('/login', csrfProtection, (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('login', { csrfToken: req.csrfToken() });
});

router.post('/login', authRateLimiter, csrfProtection, async (req, res) => {
  const { identifier, password, remember } = req.body;
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE (username = ? OR email = ?) AND status = "active"', identifier, identifier);
  if (!user) return res.status(401).send('Sai thông tin đăng nhập');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).send('Sai thông tin đăng nhập');
  req.session.userId = user.id;
  if (remember) req.session.cookie.maxAge = 30*24*60*60*1000; // 30d
  await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP, last_activity = CURRENT_TIMESTAMP WHERE id = ?', user.id);
  res.redirect('/admin');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
