// server/middlewares/lastActivity.js
import { getDb } from "../utils/db.js";
export async function touchActivity(req, res, next) {
  try {
    if (req.session && req.session.user_id) {
      const db = await getDb();
      await db.run(`UPDATE users SET last_activity = NOW() WHERE id = ?`, [
        req.session.user_id,
      ]);
    }
  } catch (e) {
    console.warn("[lastActivity]", e.message);
  }
  next();
}
