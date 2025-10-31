// scripts/migrate_is_primary.js
import { getDb } from '../server/utils/db.js';

try {
  const db = await getDb();

  // Kiểm tra cột is_primary đã tồn tại chưa
  const cols = await db.all('PRAGMA table_info(posts_categories)');
  const hasIsPrimary = cols.some(c => String(c.name).toLowerCase() === 'is_primary');

  if (!hasIsPrimary) {
    console.log('[migrate] Adding column posts_categories.is_primary ...');
    await db.run('ALTER TABLE posts_categories ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;');
    console.log('[migrate] Column added.');
  } else {
    console.log('[migrate] Column is_primary already exists. Skipping ADD COLUMN.');
  }

  // Backfill: đặt 1 danh mục chính cho mỗi post nếu chưa có
  console.log('[migrate] Backfilling primary categories ...');
  await db.run(`
    UPDATE posts_categories
       SET is_primary = 1
     WHERE (post_id, category_id) IN (
       SELECT post_id, MIN(category_id)
         FROM posts_categories
        GROUP BY post_id
     )
       AND is_primary = 0
  `);

  console.log('[migrate] Done ✅');
  process.exit(0);
} catch (e) {
  console.error('[migrate] Error:', e);
  process.exit(1);
}
