// server/app.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import cron from "node-cron";

// 🔑 Nạp biến môi trường SỚM, trước khi khởi tạo session/DB
dotenv.config();

// middlewares
import { loadUser } from "./middlewares/auth.js";
import { touchActivity } from "./middlewares/lastActivity.js";
import { csrfProtection, attachCsrfToken } from "./middlewares/csrf.js";
import { enforceSessionVersion } from "./middlewares/sessionVersion.js";
import { flash } from "./middlewares/flash.js";

// routers
import adminDashboard from "./routes/admin_dashboard.js";
import authRoutes from "./routes/auth.js";
import pagesRoutes from "./routes/pages.js";
import postsRoutes from "./routes/posts.js";
import categoriesRoutes from "./routes/categories.js";
import tagsRoutes from "./routes/tags.js";
import mediaRoutes from "./routes/media.js";
import settingsRoutes from "./routes/settings.js";
import settingsExtra from "./routes/settings_extra.js";
import usersRoutes from "./routes/users.js";
import logsRoutes from "./routes/logs.js";
import trashRoutes from "./routes/trash.js";
import searchRoutes from "./routes/search.js";
import seoSettingsRoutes from "./routes/seo-settings.js";
import seoPublicRoutes from "./routes/seo-public.js";
import sitemapRoutes from "./routes/sitemap.js";
import robotsRoutes from "./routes/robots.js";
import profileRoutes from "./routes/profile.js";
import mediaFoldersRoutes from "./routes/media_folders.js";
import doclibRoutes from "./routes/doclib.js";

// services (cron)
import { purgeActivityLogs } from "./services/activity.js";
import { runSchedulerTick } from "./services/scheduler.js";
import { purgeTrash } from "./services/trash.js";

// ⚠️ NẠP SESSION SAU KHI dotenv.config(): dùng dynamic import để tránh đọc .env quá sớm
const { sessionMiddleware } = await import("./utils/session.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// simple access log
app.use((req, res, next) => {
  const t = Date.now();
  res.on("finish", () => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    console.log(ip, ">", req.method, req.url, "<", res.statusCode, Date.now() - t + "ms");
  });
  next();
});

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Security & parsers
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));

// Static
app.use("/css", express.static(path.join(__dirname, "../public/css")));
app.use("/js", express.static(path.join(__dirname, "../public/js")));
app.use("/assets", express.static(path.join(__dirname, "../public/assets")));
app.use("/uploads", express.static(path.resolve(process.env.UPLOAD_DIR || "./uploads")));

// ✅ Sessions (MySQL session store, KHÔNG dùng connect-sqlite3 nữa)
app.use(sessionMiddleware);

// flash phải sau session
app.use(flash());

// User, session version, activity, CSRF
app.use(loadUser);
app.use(enforceSessionVersion);
app.use(touchActivity);
app.use(csrfProtection);
app.use(attachCsrfToken);

// Gắn các biến dùng chung cho view (gộp lại, tránh trùng lặp)
app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.req = req;
  res.locals.currentPath = req.originalUrl || req.path || "";
  next();
});

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Routes
app.use("/", authRoutes);
app.use("/admin", adminDashboard);
app.use("/admin/pages", pagesRoutes);
app.use("/admin/posts", postsRoutes);
app.use("/admin/categories", categoriesRoutes);
app.use("/admin/tags", tagsRoutes);
app.use("/admin/media", mediaRoutes);
app.use("/admin/users", usersRoutes);
app.use("/admin/settings", settingsRoutes);
app.use("/admin/settings", settingsExtra);
app.use("/admin/logs", logsRoutes);
app.use("/admin/trash", trashRoutes);
app.use("/admin/search", searchRoutes);
app.use("/admin/profile", profileRoutes);

// Mount admin SEO settings
app.use("/admin/settings/seo", seoSettingsRoutes);

// Public SEO endpoints
app.use("/", seoPublicRoutes);

// sitemap & robots
app.use("/", sitemapRoutes);   // /sitemap.xml
app.use("/", robotsRoutes);    // /robots.txt

// Media folders & doclib
app.use("/admin/media", mediaFoldersRoutes);
app.use(doclibRoutes);

// Cron (giữ cấu hình như bạn)
cron.schedule("15 3 * * *", async () => { try { await purgeActivityLogs(); } catch {} });
//cron.schedule("*/5 * * * *", async () => { try { await runSchedulerTick(); } catch {} });
cron.schedule("* * * * *", async () => { try { await runSchedulerTick(); } catch {} });
cron.schedule("0 2 * * *", async () => { try { await purgeTrash(); } catch {} });

const PORT = process.env.APP_PORT || 5000;
app.listen(PORT, () => {
  console.log(`DMDC CMS listening on http://localhost:${PORT}`);
});

// ==== JSON error for media & API ====
app.use((err, req, res, next) => {
  // CSRF lỗi -> trả JSON nếu là endpoint media / chấp nhận JSON
  if (err && err.code === 'EBADCSRFTOKEN') {
    const wantsJson = req.headers.accept?.includes('application/json') || req.path.startsWith('/admin/media');
    if (wantsJson) {
      return res.status(403).json({ ok: false, error: 'Invalid CSRF token' });
    }
  }
  // Các lỗi khác: trả JSON cho media endpoints
  if (req.path.startsWith('/admin/media')) {
    return res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
  }
  next(err);
});

