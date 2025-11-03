// server/routes/seo-settings.js
import express from "express";
import { requireRoles } from "../middlewares/auth.js";
import { getSetting, setSetting } from "../services/settings.js";

const router = express.Router();

router.get("/", requireRoles("admin", "editor"), async (req, res) => {
  const data = {
    site_name:                 await getSetting("seo.site_name", ""),
    meta_title_template:       await getSetting("seo.meta_title_template", "%title% | %site_name%"),
    meta_description_template: await getSetting("seo.meta_description_template", "%excerpt%"),
    robots_index_default:      await getSetting("seo.robots_index_default", "index"),
    robots_follow_default:      await getSetting("seo.robots_follow_default", "follow"),
    robots_advanced_default:    await getSetting("seo.robots_advanced_default", ""),
    canonical_enabled:          await getSetting("seo.canonical_enabled", "1"),
    schema_type_default:        await getSetting("seo.schema_type_default", "WebPage"),
    jsonld_custom_default:      await getSetting("seo.jsonld_custom_default", ""),
    og_type_default:            await getSetting("seo.og_type_default", "website"),
    twitter_card_default:       await getSetting("seo.twitter_card_default", "summary_large_image"),
  };

  res.render("settings/seo", {
    pageTitle: "Cài đặt SEO",
    // Truyền CẢ 2 để view nào cũng dùng được:
    data,            // dùng kiểu data['seo.site_name']
    seo: data,       // dùng kiểu seo.site_name
    ok: !!req.query.ok,
    err: req.query.err || null,
    csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || "")
  });
});

router.post("/", requireRoles("admin", "editor"), async (req, res) => {
  try {
    // Đọc được cả name="site_name" lẫn name="seo.site_name"
    const get = (k) => req.body[k] ?? req.body[`seo.${k}`] ?? "";

    const site_name                 = get("site_name");
    const meta_title_template       = get("meta_title_template");
    const meta_description_template = get("meta_description_template");
    const robots_index_default      = get("robots_index_default") || "index";
    const robots_follow_default     = get("robots_follow_default") || "follow";
    const robots_advanced_default   = get("robots_advanced_default");
    const canonical_enabled         = (get("canonical_enabled") === "1" || get("canonical_enabled") === "on") ? "1" : "0";
    const schema_type_default       = get("schema_type_default") || "WebPage";
    const jsonld_custom_default     = get("jsonld_custom_default");
    const og_type_default           = get("og_type_default") || "website";
    const twitter_card_default      = get("twitter_card_default") || "summary_large_image";

    await setSetting("seo.site_name", site_name);
    await setSetting("seo.meta_title_template", meta_title_template);
    await setSetting("seo.meta_description_template", meta_description_template);
    await setSetting("seo.robots_index_default", robots_index_default);
    await setSetting("seo.robots_follow_default", robots_follow_default);
    await setSetting("seo.robots_advanced_default", robots_advanced_default);
    await setSetting("seo.canonical_enabled", canonical_enabled);
    await setSetting("seo.schema_type_default", schema_type_default);
    await setSetting("seo.jsonld_custom_default", jsonld_custom_default);
    await setSetting("seo.og_type_default", og_type_default);
    await setSetting("seo.twitter_card_default", twitter_card_default);

    return res.redirect("/admin/settings/seo?ok=1");
  } catch (e) {
    const msg = encodeURIComponent(e.message || String(e));
    return res.redirect(`/admin/settings/seo?err=${msg}`);
  }
});

export default router;
