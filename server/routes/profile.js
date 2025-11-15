// server/routes/profile.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getUserById, updateUser, setPassword } from "../services/users.js";
import { logActivity } from "../services/activity.js";

const router = express.Router();

/** View */
router.get("/", requireAuth, async (req,res) => {
  const me = await getUserById(req.user.id);
  res.render("profile/index", {
    pageTitle: "Hồ sơ của tôi",
    me,
    ok: req.query.ok, err: req.query.err
  });
});

/** Update info */
router.post("/info", requireAuth, async (req,res) => {
  try {
    await updateUser(req.user.id, req.body);
    await logActivity(req.user.id, "user_profile_updated", "user", req.user.id);
    res.redirect("/admin/profile?ok=updated");
  } catch (e) {
    res.redirect("/admin/profile?err=update_failed");
  }
});

/** Change password */
router.post("/security/password", requireAuth, async (req,res) => {
  const { current_password, new_password } = req.body;
  // tuỳ dự án bạn đang kiểm tra current_password ở middleware khác; ở đây tối thiểu đặt mới
  if (!new_password || new_password.length < 6) return res.redirect("/admin/profile?err=weak_password");
  await setPassword(req.user.id, new_password);
  await logActivity(req.user.id, "user_password_changed", "user", req.user.id);
  res.redirect("/admin/profile?ok=password_changed");
});

/** Preferences (theme, editor, locale...) */
router.post("/prefs", requireAuth, async (req,res) => {
  try {
    await updateUser(req.user.id, req.body);
    await logActivity(req.user.id, "user_preferences_changed", "user", req.user.id);
    res.redirect("/admin/profile?ok=prefs_saved");
  } catch {
    res.redirect("/admin/profile?err=prefs_failed");
  }
});

export default router;
