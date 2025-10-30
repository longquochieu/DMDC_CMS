import { getDb } from '../utils/db.js';
export async function enforceSessionVersion(req, res, next){
  try{
    if (!req.session || !req.session.user) return next();
    const db = await getDb();
    const row = await db.get('SELECT session_version FROM users WHERE id=?', req.session.user.id);
    const sv = req.session.user.session_version || 1;
    if (row && typeof row.session_version === 'number' && sv !== row.session_version){
      req.session.destroy(()=> res.redirect('/login'));
      return;
    }
  }catch(e){}
  next();
}
