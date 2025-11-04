// server/app.js
import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import dotenv from "dotenv";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import cron from "node-cron";

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
import sitemapRoutes from './routes/sitemap.js';
import robotsRoutes from './routes/robots.js';

// services (cron)
import { runSchedulerTick } from "./services/scheduler.js";
import { purgeTrash } from "./services/trash.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// simple access log
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    console.log((req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''), '>', req.method, req.url, '<', res.statusCode, (Date.now() - t) + 'ms');
  });
  next();
});

const SQLiteStore = SQLiteStoreFactory(session);

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Security & parsers
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Static
app.use("/css", express.static(path.join(__dirname, "../public/css")));
app.use("/js", express.static(path.join(__dirname, "../public/js")));
app.use("/assets", express.static(path.join(__dirname, "../public/assets")));
app.use("/uploads", express.static(path.resolve(process.env.UPLOAD_DIR || "./uploads")));

// Sessions (SQLite store)
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: path.resolve("./data") }),
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false },
  })
);

// flash phải sau session
app.use(flash());

// User, session version, activity, CSRF
app.use(loadUser);
app.use(enforceSessionVersion);
app.use(touchActivity);
app.use(csrfProtection);
app.use(attachCsrfToken);

// user vào locals
app.use((req, res, next) => { res.locals.user = req.user; next(); });
app.use((req, res, next) => { res.locals.req = req; next(); });

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

// Mount admin SEO settings
app.use("/admin/settings/seo", seoSettingsRoutes);

// Public SEO endpoints
app.use("/", seoPublicRoutes);

// Mount routes (giữ nguyên các app.use khác)
app.use('/', sitemapRoutes);            // /sitemap.xml
app.use('/', robotsRoutes);             // /robots.txt

// Cron
//cron.schedule("*/5 * * * *", async () => { try { await runSchedulerTick(); } catch {} });
cron.schedule("* * * * *",  async () => { try { await runSchedulerTick(); } catch {} });
cron.schedule("0 2 * * *",  async () => { try { await purgeTrash(); } catch {} });

const PORT = process.env.APP_PORT || 5000;
app.listen(PORT, () => {
  console.log(`DMDC CMS listening on http://localhost:${PORT}`);
});
