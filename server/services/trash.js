import { getDb } from '../utils/db.js';

export async function purgeTrash() {
  const db = await getDb();
  const rows = await db.all(`SELECT 'posts' as t, id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now','-30 days')
                             UNION ALL
                             SELECT 'pages', id FROM pages WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now','-30 days')
                             UNION ALL
                             SELECT 'categories', id FROM categories WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now','-30 days')
                             UNION ALL
                             SELECT 'tags', id FROM tags WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now','-30 days')
                             UNION ALL
                             SELECT 'media', id FROM media WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now','-30 days')`);
  for (const r of rows) {
    await db.run(`DELETE FROM ${r.t} WHERE id = ?`, r.id);
  }
  return rows.length;
}
