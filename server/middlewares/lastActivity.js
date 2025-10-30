import { getDb } from '../utils/db.js';

export async function touchActivity(req, res, next) {
  try {
    if (!req.user) return next();

    const p = req.path || '';
    if (p.startsWith('/css') || p.startsWith('/js') || p.startsWith('/assets') ||
        p.startsWith('/uploads') || p === '/favicon.ico') {
      return next();
    }

    const now = Date.now();
    if ((req.session._lastActivityAt || 0) + 60000 < now) {
      const db = await getDb();
      await db.run('UPDATE users SET last_activity = datetime("now") WHERE id = ?', req.user.id);
      req.session._lastActivityAt = now;
    }
  } catch (e) {
    console.warn('[lastActivity]', e.message);
  }
  return next();
}
