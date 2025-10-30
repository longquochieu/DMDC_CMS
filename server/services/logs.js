import { getDb } from '../utils/db.js';
export async function logActivity(actorId, action, entityType, entityId, meta = {}){
  const db = await getDb();
  await db.run('INSERT INTO activity_logs(actor_id, action, entity_type, entity_id, meta) VALUES(?,?,?,?,?)',
    actorId || null, action, entityType, entityId, JSON.stringify(meta || {}));
}
