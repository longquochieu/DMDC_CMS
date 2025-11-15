// server/services/trash.js
import { getDb } from '../utils/db.js';

export async function purgeTrash() {
  const db = await getDb();

  // Xoá vĩnh viễn các bản ghi đã bị soft-delete quá 30 ngày
  const rows = await db.all(
    `SELECT 'posts'      AS t, id FROM posts
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)
     UNION ALL
     SELECT 'pages'      AS t, id FROM pages
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)
     UNION ALL
     SELECT 'categories' AS t, id FROM categories
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)
     UNION ALL
     SELECT 'tags'       AS t, id FROM tags
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)
     UNION ALL
     SELECT 'media'      AS t, id FROM media
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  for (const row of rows) {
    // row.t chỉ có thể là 'posts' | 'pages' | 'categories' | 'tags' | 'media'
    await db.run(`DELETE FROM ${row.t} WHERE id = ?`, [row.id]);
  }

  return rows.length;
}
