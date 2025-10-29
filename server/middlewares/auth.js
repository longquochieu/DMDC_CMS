import { getDb } from '../utils/db.js';

export async function loadUser(req, res, next) {
  if (!req.session.userId) return next();
  const db = await getDb();
  const user = await db.get('SELECT id, username, email, role, avatar FROM users WHERE id = ?', req.session.userId);
  if (user) req.user = user;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return res.status(403).send('Forbidden');
    next();
  };
}
