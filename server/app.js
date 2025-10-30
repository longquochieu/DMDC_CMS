// server/app.js
import express from "express";
import session from "express-session";
import csrf from 'csurf';
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
import { csrfProtection } from "./middlewares/csrf.js";
import { enforceSessionVersion } from "./middlewares/sessionVersion.js";

// routers (KHÔNG dùng adminRoutes cũ nữa)
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

// services (cron)
import { runSchedulerTick } from "./services/scheduler.js";
import { purgeTrash } from "./services/trash.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ TẠI ĐÂY MỚI KHAI BÁO app
const app = express();
app.use((req, res, next) => {
  const t = Date.now();
  console.log('> ', req.method, req.url);
  res.on('finish', () => {
    console.log('< ', req.method, req.url, res.statusCode, (Date.now() - t) + 'ms');
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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// User, activity, CSRF
app.use(loadUser);
app.use(enforceSessionVersion);
app.use(touchActivity);
app.use(csrfProtection);
app.use(csrf({
	cookie: true,
	ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
}));
app.use((req, res, next) => {
  try { res.locals.csrfToken = req.csrfToken(); } catch { res.locals.csrfToken = ""; }
  res.locals.user = req.user;
  next();
});

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Routes (đúng thứ tự, tránh trùng /admin)
app.use("/", authRoutes);
app.use("/admin", adminDashboard);            // Dashboard /admin
app.use("/admin/pages", pagesRoutes);
app.use("/admin/posts", postsRoutes);
app.use("/admin/categories", categoriesRoutes);
app.use("/admin/tags", tagsRoutes);
app.use("/admin/media", mediaRoutes);
app.use("/admin/users", usersRoutes);
app.use("/admin/settings", settingsRoutes);   // routes/settings.js (có form settings)
app.use("/admin/settings", settingsExtra);    // routes/settings_extra.js (branding/seo POST)
app.use("/admin/logs", logsRoutes);
app.use("/admin/trash", trashRoutes);
app.use("/admin/search", searchRoutes);

// Cron
cron.schedule("*/5 * * * *", async () => { try { await runSchedulerTick(); } catch {} });
cron.schedule("0 2 * * *",  async () => { try { await purgeTrash(); } catch {} });

const PORT = process.env.APP_PORT || 5000;
app.listen(PORT, () => {
  console.log(`DMDC CMS listening on http://localhost:${PORT}`);
});
