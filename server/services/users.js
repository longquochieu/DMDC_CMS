// server/services/users.js
import bcrypt from "bcryptjs";
import { getDb } from "../utils/db.js";

const SALT_ROUNDS = 10;

/**
 * Danh sách người dùng (lọc theo q, role, status).
 * LƯU Ý: Trả thêm alias avatar / avatar_path (NULL) để view không lỗi khi thiếu cột.
 */
export async function listUsers({ q = "", role = "", status = "" } = {}) {
  const db = await getDb();

  const where = ["u.deleted_at IS NULL"];
  const params = [];

  if (q) {
    // tìm theo username / email / display_name (case-insensitive)
    where.push(
      "(LOWER(u.username)=LOWER(?) OR LOWER(u.email)=LOWER(?) OR LOWER(u.display_name)=LOWER(?))"
    );
    params.push(q, q, q);
  }
  if (role) {
    where.push("u.role = ?");
    params.push(role);
  }
  if (status) {
    where.push("u.status = ?");
    params.push(status);
  }

  const sql = `
    SELECT
      u.id,
      u.username,
      u.email,
      u.role,
      COALESCE(u.status, 'active')       AS status,
      COALESCE(u.display_name, u.username) AS display_name,
      u.session_version,
      u.last_activity,
      u.created_at,
      /* alias để view không phụ thuộc cột ảnh (nếu DB chưa có) */
      NULL AS avatar,
      NULL AS avatar_path
    FROM users u
    WHERE ${where.join(" AND ")}
    ORDER BY u.id DESC
    LIMIT 1000
  `;
  return db.all(sql, params);
}

/**
 * Lấy 1 user theo id.
 */
export async function getUserById(id) {
  const db = await getDb();
  const row = await db.get(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      u.role,
      COALESCE(u.status, 'active')         AS status,
      COALESCE(u.display_name, u.username) AS display_name,
      u.session_version,
      u.last_activity,
      u.created_at,
      NULL AS avatar,
      NULL AS avatar_path
    FROM users u
    WHERE u.id = ? AND u.deleted_at IS NULL
    LIMIT 1
  `,
    [id]
  );
  return row || null;
}

/**
 * Tạo user mới. BẮT BUỘC có password để không lỗi default value.
 * Trả về id vừa tạo.
 */
export async function createUser(body = {}) {
  const db = await getDb();

  const username = (body.username || "").trim();
  const email = (body.email || "").trim() || null;
  const role = body.role || "author";
  const status = body.status || "active";
  const display_name = body.display_name || username || email || "";

  // nhận mật khẩu từ nhiều key thường gặp trên form
  let password =
    body.password || body.new_password || body.pass || body.password1 || "";

  if (!username) throw new Error("Vui lòng nhập username");
  if (!password || password.length < 6)
    throw new Error("Mật khẩu tối thiểu 6 ký tự");

  const dup = await db.get(
    `SELECT 1 AS ok FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?) LIMIT 1`,
    [username, email || username]
  );
  if (dup?.ok) throw new Error("Username hoặc email đã tồn tại");

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  await db.run(
    `
    INSERT INTO users(
      username, email, role, status, display_name,
      password_hash, session_version, created_at, updated_at
    )
    VALUES( ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP )
  `,
    [username, email, role, status, display_name, hash]
  );

  const idRow = await db.get(`SELECT LAST_INSERT_ID() AS id`);
  return idRow?.id;
}

/**
 * Cập nhật metadata (không đổi mật khẩu ở đây).
 * Chỉ cập nhật field có trong body; luôn set updated_at.
 */
export async function updateUser(id, data = {}) {
  const db = await getDb();

  const fields = [];
  const params = [];

  if (data.username != null) {
    fields.push("username = ?");
    params.push((data.username || "").trim());
  }
  if (data.email != null) {
    fields.push("email = ?");
    params.push((data.email || "").trim() || null);
  }
  if (data.role != null) {
    fields.push("role = ?");
    params.push(data.role);
  }
  if (data.status != null) {
    fields.push("status = ?");
    params.push(data.status);
  }
  if (data.display_name != null) {
    fields.push("display_name = ?");
    params.push(data.display_name || "");
  }

  // Nếu không có field nào, vẫn update updated_at để không lỗi
  fields.push("updated_at = CURRENT_TIMESTAMP");

  const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
  params.push(id);

  await db.run(sql, params);
  return true;
}

/**
 * Đặt lại mật khẩu (hash + bump session_version).
 */
export async function setPassword(id, newPassword) {
  const db = await getDb();
  if (!newPassword || newPassword.length < 6)
    throw new Error("Mật khẩu tối thiểu 6 ký tự");

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.run(
    `
    UPDATE users
       SET password_hash = ?,
           session_version = COALESCE(session_version, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `,
    [hash, id]
  );
  return true;
}
