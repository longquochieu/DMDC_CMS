// server/routes/seo-settings.js
import express from "express";
import { requireRoles } from "../middlewares/auth.js";
import { getSetting, setSetting, getSettingsBulk } from "../services/settings.js";

const router = express.Router();

const KEYS = [
  // mặc định (đã có)
  "seo.site_name", "seo.site_url", "seo.default_lang", "seo.separator",
  "seo.robots_default",
  // GA4
  "ga4.enabled", "ga4.measurement_id",
  // Defaults OG/Twitter
  "seo.default_og_title", "seo.default_og_description", "seo.default_og_image",
  "seo.default_twitter_title", "seo.default_twitter_description", "seo.default_twitter_image"
];

router.get("/", requireRoles("admin"), async (req, res) => {
  const data = await getSettingsBulk(KEYS);
  res.render("settings/seo", {
    pageTitle: "Cài đặt SEO",
    data,
    ok: req.query.ok || "",
    err: req.query.err || "",
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || "")
  });
});

router.post("/", requireRoles("admin"), async (req, res) => {
  try {
    await setSetting("seo.site_name", req.body["seo.site_name"] || "");
    await setSetting("seo.site_url",  req.body["seo.site_url"]  || "");
    await setSetting("seo.default_lang", req.body["seo.default_lang"] || "vi");
    await setSetting("seo.separator", req.body["seo.separator"] || " - ");
    await setSetting("seo.robots_default", req.body["seo.robots_default"] || "");

    await setSetting("ga4.enabled", req.body["ga4.enabled"] ? "1" : "0");
    await setSetting("ga4.measurement_id", (req.body["ga4.measurement_id"] || "").trim());

    await setSetting("seo.default_og_title", req.body["seo.default_og_title"] || "");
    await setSetting("seo.default_og_description", req.body["seo.default_og_description"] || "");
    await setSetting("seo.default_og_image", req.body["seo.default_og_image"] || "");

    await setSetting("seo.default_twitter_title", req.body["seo.default_twitter_title"] || "");
    await setSetting("seo.default_twitter_description", req.body["seo.default_twitter_description"] || "");
    await setSetting("seo.default_twitter_image", req.body["seo.default_twitter_image"] || "");

    return res.redirect("/admin/settings/seo?ok=saved");
  } catch (e) {
    return res.redirect(`/admin/settings/seo?err=${encodeURIComponent(e.message)}`);
  }
});

export default router;
