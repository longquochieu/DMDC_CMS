// server/routes/settings_extra.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireRoles } from "../middlewares/auth.js";
import { setSetting } from "../services/settings.js";

const router = express.Router();

// ====== BRANDING (logo, favicon) ======
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const brandingDir = path.join(uploadRoot, "branding");
fs.mkdirSync(brandingDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, brandingDir);
  },
  filename(req, file, cb) {
    const ext = (path.extname(file.originalname || "") || ".png").toLowerCase();
    const base =
      file.fieldname === "site_favicon" ? "favicon" : "logo";
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post(
  "/branding",
  requireRoles("admin", "editor"),
  upload.fields([
    { name: "site_logo", maxCount: 1 },
    { name: "site_favicon", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const urlBase = "/uploads/branding";

      if (files.site_logo && files.site_logo[0]) {
        const f = files.site_logo[0];
        await setSetting("site_logo", `${urlBase}/${f.filename}`);
      }

      if (files.site_favicon && files.site_favicon[0]) {
        const f = files.site_favicon[0];
        await setSetting("site_favicon", `${urlBase}/${f.filename}`);
      }

      return res.redirect("/admin/settings?ok=brandingSaved");
    } catch (e) {
      console.error("Branding error:", e);
      return res
        .status(500)
        .send(e.message || "Branding settings error");
    }
  }
);

// ====== SEO / Analytics EXTRA (GA4, GSC, limit) ======
router.post(
  "/seo-extra",
  requireRoles("admin", "editor"),
  async (req, res) => {
    try {
      const {
        ga4_measurement_id,
        gsc_meta_tag,
        max_image_size_mb,
        disk_alert_mb,
      } = req.body;

      const ga4Id = (ga4_measurement_id || "").trim();

      // Đồng bộ với module SEO: dùng ga4.measurement_id + ga4.enabled
      await setSetting("ga4.measurement_id", ga4Id);
      await setSetting("ga4.enabled", ga4Id ? "1" : "0");

      await setSetting("gsc_meta_tag", (gsc_meta_tag || "").trim());

      const maxSize = Number.parseInt(max_image_size_mb, 10) || 5;
      const diskAlert = Number.parseInt(disk_alert_mb, 10) || 500;

      await setSetting("max_image_size_mb", String(maxSize));
      await setSetting("disk_alert_mb", String(diskAlert));

      return res.redirect("/admin/settings?ok=seoExtraSaved");
    } catch (e) {
      console.error("SEO extra error:", e);
      return res
        .status(500)
        .send(e.message || "SEO extra settings error");
    }
  }
);

export default router;
