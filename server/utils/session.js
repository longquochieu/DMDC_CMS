// server/utils/session.js
import session from "express-session";

export const sessionMiddleware = await (async () => {
  const isMySQL =
    (process.env.DB_DRIVER || "").toLowerCase() === "mysql" ||
    !!process.env.MYSQL_HOST;

  let store;
  if (isMySQL) {
    const createMySQLStore = (await import("express-mysql-session")).default;
    const MySQLStore = createMySQLStore(session);
    store = new MySQLStore({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "",
      charset: process.env.MYSQL_CHARSET || "utf8mb4",
      clearExpired: true,
      checkExpirationInterval: 15 * 60 * 1000, // 15 phút
      expiration: 7 * 24 * 60 * 60 * 1000,     // 7 ngày
      createDatabaseTable: true,
      schema: {
        tableName: "sessions",
        columnNames: { session_id: "sid", expires: "expires", data: "data" },
      },
    });
    console.log("[SESSION] Using MySQL session store");
  } else {
    store = new session.MemoryStore();
    console.log("[SESSION] Using MemoryStore (dev only)");
  }

  return session({
    store,
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // dev: false; prod (https) nên true
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
})();
