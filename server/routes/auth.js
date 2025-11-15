// server/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import { getDb } from "../utils/db.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

// GET /login
router.get("/login", (req, res) => {
  if (req.user) return res.redirect("/admin");
  res.render("login", { pageTitle: "Đăng nhập", error: null });
});

// POST /login
router.post("/login", async (req, res) => {
  try {
    const login =
      (req.body.username || req.body.email || req.body.login || "").trim();
    const password = req.body.password || "";

    if (!login || !password) {
      return res.status(401).render("login", {
        pageTitle: "Đăng nhập",
        error: "Sai tài khoản hoặc mật khẩu",
      });
    }

    const db = await getDb();
    // Tìm user theo username/email (không phân biệt hoa thường)
    const row = await db.get(
      `
      SELECT
        id, username, email, role,
        password_hash,
        session_version,
        deleted_at
      FROM users
      WHERE (LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?))
      LIMIT 1
      `,
      [login, login]
    );

    // Sai user hoặc user đã bị xoá mềm
    if (!row || row.deleted_at) {
      return res.status(401).render("login", {
        pageTitle: "Đăng nhập",
        error: "Sai tài khoản hoặc mật khẩu",
      });
    }

    // So khớp mật khẩu
    const ok = await bcrypt.compare(password, row.password_hash || "");
    if (!ok) {
      return res.status(401).render("login", {
        pageTitle: "Đăng nhập",
        error: "Sai tài khoản hoặc mật khẩu",
      });
    }

    // ✅ Tăng phiên + cập nhật hoạt động cuối (MySQL-safe)
    await db.run(
      `
      UPDATE users
         SET session_version = session_version + 1,
             last_activity   = CURRENT_TIMESTAMP
       WHERE id = ?
      `,
      [row.id]
    );

    // Lấy lại session_version mới để đưa vào session
    const v = await db.get(
      `SELECT session_version FROM users WHERE id = ?`,
      [row.id]
    );
    const newSessionVersion =
      (v && v.session_version) != null
        ? v.session_version
        : (row.session_version || 0) + 1;

    // Regenerate session để an toàn phiên
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );

    // Lưu thông tin tối thiểu vào session
    req.session.user_id = row.id;
    req.session.session_version = newSessionVersion;

    // Gắn req.user cho request hiện tại (loadUser sẽ xử lý cho các request sau)
    req.user = { id: row.id, username: row.username, role: row.role };

    // Ghi log đăng nhập (không chặn flow nếu lỗi)
    try {
      await logActivity(row.id, "login", "user", row.id, {
        ip: req.ip,
        user_agent: req.headers["user-agent"],
      });
    } catch {}

    return res.redirect("/admin");
  } catch (e) {
    console.error("[POST /login] error:", e);
    return res.status(500).render("login", {
      pageTitle: "Đăng nhập",
      error: "Có lỗi hệ thống",
    });
  }
});

// GET /logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

export default router;
