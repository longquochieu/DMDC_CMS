// scripts/fix-admin-login.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getDb } from '../server/utils/db.js';

async function main() {
  const username = process.argv[2];
  const newPass  = process.argv[3];

  if (!username || !newPass) {
    console.error('Cách dùng: node scripts/fix-admin-login.js <usernameOrEmail> <newPassword>');
    process.exit(1);
  }

  const db = await getDb();
  console.log(`[DB] Using ${db.driver === 'mysql' ? 'MySQL' : 'SQLite'}`);

  // 1) Lấy user
  const user = await db.get(
    `SELECT id, username, email, role, password_hash, deleted_at
       FROM users
      WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)
      ORDER BY id ASC
      LIMIT 1`,
    [username, username]
  );

  if (!user) {
    console.error('❌ Không tìm thấy user để cập nhật');
    process.exit(2);
  }

  // 2) Sinh hash
  const hash = await bcrypt.hash(newPass, 10);

  // 3) Cập nhật đúng cách (binding MẢNG tham số)
  await db.run(
    `UPDATE users
        SET password_hash = ?,
            session_version = COALESCE(session_version, 0) + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [hash, user.id]
  );

  // 4) Tự verify lại ngay
  const after = await db.get(`SELECT id, username, password_hash FROM users WHERE id=?`, [user.id]);
  const ok = await bcrypt.compare(newPass, after.password_hash || '');

  if (!ok) {
    console.error('⚠️ Cập nhật xong nhưng compare vẫn KHÔNG khớp.');
    console.error('> Kiểm tra kiểu cột password_hash (VARCHAR, không phải CHAR).');
    console.error('> Kiểm tra có space/ký tự lạ trong hash (độ dài phải ~60).');
    process.exit(3);
  }

  console.log(`✅ Đã cập nhật mật khẩu user: ${user.username}`);
  console.log(`👉 User sau cập nhật: { id: ${user.id}, username: ${user.username} }`);
}

main().catch((e) => {
  console.error(e);
  process.exit(9);
});
