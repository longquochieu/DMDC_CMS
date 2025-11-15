// server/middlewares/auth.js
import { getDb } from '../utils/db.js';

export async function loadUser(req, res, next) {
  try {
    const uid = req.session?.user_id;
    if (!uid) { req.user = null; return next(); }

    const db = await getDb();
    const row = await db.get(
      "SELECT id, username, role, session_version FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [uid]               // ✅ BẮT BUỘC là mảng
    );

    if (!row) { req.user = null; return next(); }

    req.user = {
      id: row.id,
      username: row.username,
      role: row.role,
      session_version: row.session_version || 0
    };
    return next();
  } catch (e) {
    console.error("[loadUser]", e);
    req.user = null;
    return next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.session || !req.session.user_id) {
    return res.redirect('/login');
  }
  return next();
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      console.warn('403 requireRoles: no user', req.method, req.originalUrl);
      return res.status(403).send('Forbidden');
    }
    const ok = roles.includes(req.user.role);
    if (!ok) {
      console.warn('403 requireRoles: user=%s role=%s url=%s need=%j',
        req.user.username, req.user.role, req.originalUrl, roles);
      return res.status(403).send('Forbidden');
    }
    next();
  };
}
