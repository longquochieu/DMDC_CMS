// server/routes/users.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { listUsers, getUserById, createUser, updateUser, setPassword} from "../services/users.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

/** List */
router.get("/", requireRoles("admin"), async (req, res) => {
  try {
    const { q = "", role = "", status = "" } = req.query;
    const rows = await listUsers({ q, role, status });

    // Chuẩn hoá dữ liệu để view không phụ thuộc đúng tên cột
    const normalized = (rows || []).map((u) => ({
      ...u,
      // hiển thị tên
      display_name: u.display_name || u.username || "",
      // đồng bộ trường avatar cho view (fallback từ avatar_path)
      avatar: u.avatar ?? u.avatar_path ?? "",
      // nếu view cũ còn dùng avatar_url, ta gán dự phòng
      avatar_url: u.avatar_url ?? u.avatar ?? u.avatar_path ?? "",
    }));

    return res.render("users/list", {
      pageTitle: "Người dùng",
      rows: normalized,
      q,
      role,
      status,
      ok: req.query.ok,
      err: req.query.err,
    });
  } catch (e) {
    // Nếu services ném lỗi SQL (ví dụ u.avatar_url), hiển thị gọn cho admin
    return res.status(500).render("users/list", {
      pageTitle: "Người dùng",
      rows: [],
      q: req.query.q || "",
      role: req.query.role || "",
      status: req.query.status || "",
      ok: null,
      err:
        "Không tải được danh sách người dùng. " +
        (e && e.message ? e.message : "Lỗi không xác định"),
    });
  }
});

/** New (form) */
router.get("/new", requireRoles("admin"), (req, res) => {
  res.render("users/edit", {
    pageTitle: "Tạo người dùng",
    mode: "create",
    item: null,
    error: null,
  });
});

/** New (submit) */
router.post("/new", requireRoles("admin"), async (req, res) => {
  try {
    const id = await createUser(req.body);
    try {
      await logActivity(req.user.id, "user_created", "user", id);
    } catch {}
    return res.redirect("/admin/users?ok=created");
  } catch (e) {
    return res.status(400).render("users/edit", {
      pageTitle: "Tạo người dùng",
      mode: "create",
      item: req.body,
      error: e.message || String(e),
    });
  }
});

/** Edit (form) */
router.get("/:id/edit", requireRoles("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = await getUserById(id);
  if (!item) return res.status(404).send("Không tìm thấy người dùng");
  return res.render("users/edit", {
    pageTitle: "Sửa người dùng",
    mode: "edit",
    item,
    error: null,
  });
});

/** Edit (submit) */
router.post("/:id/edit", requireRoles("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await updateUser(id, req.body);
    try {
      await logActivity(req.user.id, "user_updated", "user", id);
    } catch {}
    return res.redirect("/admin/users?ok=updated");
  } catch (e) {
    const item = await getUserById(id);
    return res.status(400).render("users/edit", {
      pageTitle: "Sửa người dùng",
      mode: "edit",
      item,
      error: e.message || String(e),
    });
  }
});

/** ✅ Đổi trạng thái (active/inactive/suspended) — endpoint riêng, body: {status} */
router.post("/:id/status", requireRoles("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body || {};
  const allowed = new Set(["active", "inactive", "suspended"]);
  if (!allowed.has(String(status || ""))) {
    return res.redirect("/admin/users?err=invalid_status");
  }
  try {
    await updateUser(id, { status: String(status) });
    await logActivity(req.user.id, "user_status_change", "user", id);
    res.redirect("/admin/users?ok=status_changed");
  } catch (e) {
    res.redirect("/admin/users?err=" + encodeURIComponent(e.message || String(e)));
  }
});

/** Reset password (admin action) */
router.post("/:id/reset-password", requireRoles("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6)
    return res.redirect("/admin/users?err=weak_password");
  await setPassword(id, new_password);
  try {
    await logActivity(req.user.id, "user_password_reset", "user", id);
  } catch {}
  return res.redirect("/admin/users?ok=password_reset");
});
export default router;
