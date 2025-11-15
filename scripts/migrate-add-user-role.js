// scripts/migrate-add-user-role.js
import { getDb } from '../server/utils/db.js';

const db = await getDb();
await db.exec('BEGIN IMMEDIATE');
try {
  // thêm cột role nếu chưa có
  const cols = await db.all(`PRAGMA table_info(users)`);
  const hasRole = cols.some(c => c.name === 'role');
  if (!hasRole) {
    await db.run(`ALTER TABLE users ADD COLUMN role TEXT`);
  }
  // gán role=admin cho user 'admin' nếu đang null/empty
  await db.run(`UPDATE users SET role='admin' WHERE username='admin' AND (role IS NULL OR role='')`);
  await db.exec('COMMIT');
  console.log('OK: ensured users.role and set admin role');
} catch (e) {
  await db.exec('ROLLBACK');
  console.error(e);
  process.exit(1);
}
process.exit(0);
