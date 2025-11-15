// scripts/check-admin-login.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getDb } from '../server/utils/db.js';

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.error('Cách dùng: node scripts/check-admin-login.js <usernameOrEmail> <password>');
    process.exit(1);
  }

  const db = await getDb();

  const row = await db.get(
    `SELECT id, username, email, role, password_hash, status, deleted_at
       FROM users
      WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)
      ORDER BY id ASC
      LIMIT 1`,
    [username, username]
  );

  if (!row) {
    console.error('❌ Không thấy user phù hợp');
    process.exit(2);
  }

  console.log('[DB] Using', db.driver === 'mysql' ? 'MySQL' : 'SQLite');
  console.log('User:', { id: row.id, username: row.username, status: row.status, deleted_at: row.deleted_at });
  console.log('Hash length:', row.password_hash ? row.password_hash.length : 0);

  try {
    const ok = await bcrypt.compare(password, row.password_hash || '');
    if (ok) {
      console.log('✅ Mật khẩu KHỚP');
      process.exit(0);
    } else {
      console.log('❌ Mật khẩu KHÔNG khớp');
      // gợi ý một vài nguyên nhân
      console.log('- Kiểm tra cột users.password_hash có phải VARCHAR(100) không (tránh CHAR).');
      console.log('- Có thể đang trỏ nhầm DB (.env), hoặc có nhiều user trùng username, script lấy user khác.');
      process.exit(3);
    }
  } catch (e) {
    console.error('Lỗi compare bcrypt:', e);
    process.exit(4);
  }
}

main().catch(e => { console.error(e); process.exit(5); });
