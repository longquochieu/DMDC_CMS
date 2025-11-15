// scripts/check-admin-login.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getDb } from '../server/utils/db.js';

async function main() {
  const [,, loginArg, passwordArg] = process.argv;

  const login = (loginArg || '').trim();      // username hoặc email
  const password = (passwordArg || '').trim();

  if (!login || !password) {
    console.error('❌ Cách dùng: node scripts/check-admin-login.js <username|email> <password>');
    process.exit(1);
  }

  const db = await getDb();

  // Giống logic route /login: tìm theo username hoặc email
  const row = await db.get(
    `SELECT id, username, email, role, password_hash
       FROM users
      WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
      LIMIT 1`,
    [login, login]
  );

  if (!row) {
    console.error('❌ Không tìm thấy user');
    process.exit(1);
  }

  const ok = await bcrypt.compare(password, row.password_hash || '');
  if (ok) {
    console.log('✅ Mật khẩu KHỚP cho user:', row.username, `(id=${row.id})`);
  } else {
    console.log('❌ Mật khẩu KHÔNG khớp');
    process.exit(2);
  }

  // In ra DB để xác nhận dùng đúng nguồn
  if (process.env.DB_DRIVER === 'mysql') {
    console.log(`🎯 DB: MySQL ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}/${process.env.MYSQL_DATABASE}`);
  } else {
    console.log(`🎯 DB (SQLite): ${process.env.DB_PATH || process.env.APP_DB}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
