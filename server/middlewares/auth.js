import { getDb } from '../utils/db.js';

export async function loadUser(req, res, next) {
  try {
    if (!req.session?.user_id) { req.user = null; return next(); }

    const db = await getDb();
    const u = await db.get(`
      SELECT id, username, email, role, display_name,
             avatar_path AS avatar, session_version, deleted_at
      FROM users WHERE id = ?`, req.session.user_id);

    if (!u || u.deleted_at) { req.user = null; return next(); }

    // enforce session_version trên middleware riêng, đừng redirect ở đây
    req.user = u;
    return next();
  } catch (e) {
    console.warn('[loadUser]', e.message);
    req.user = null;
    return next();
  }
}
// loadUser giữ nguyên như bạn đang có (alias avatar_path AS avatar...)
// Chỉ kiểm tra requireAuth thật gọn:
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.user_id) {
    return res.redirect('/login');
  }
  return next();
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return res.status(403).send('Forbidden');
    next();
  };
}
