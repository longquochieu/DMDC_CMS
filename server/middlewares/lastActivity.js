import { getDb } from '../utils/db.js';

export async function touchActivity(req, res, next) {
  try {
    if (req.session && req.session.userId) {
      const db = await getDb();
      await db.run('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?', req.session.userId);
    }
  } catch (e) {
    // non-blocking
  }
  next();
}
