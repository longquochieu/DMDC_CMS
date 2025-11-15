// server/utils/db.js
import mysql from "mysql2/promise";
import path from "path";
import fs from "fs";

// Chỉ nạp sqlite khi thật sự cần
let sqliteOpen = null;
let sqlite3Driver = null;

const pickDriver = () => {
  const d = (process.env.DB_DRIVER || "").toLowerCase();
  if (d === "mysql") return "mysql";
  if (process.env.MYSQL_HOST) return "mysql";
  return "sqlite";
};

let mysqlPool = null;
let sqliteDb = null;
let _lastInsertId = null; // giả lập last_insert_rowid() cho MySQL

/** Chuẩn hoá tham số: nhận (...args) -> trả về mảng */
function toParams(args) {
  if (!args || args.length === 0) return [];
  if (args.length === 1) {
    const p = args[0];
    return Array.isArray(p) ? p : [p];
  }
  return Array.from(args);
}

/** ===================== MySQL facade ===================== */
async function getMysqlFacade() {
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "",
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      multipleStatements: false,
	  dateStrings: true,
	  charset: process.env.MYSQL_CHARSET || "utf8mb4",
	  timezone: "Z",
      // charset và timezone nếu cần:
      // charset: process.env.MYSQL_CHARSET || "utf8mb4",
    });
    console.log(
      `[DB] Using MySQL at ${process.env.MYSQL_HOST || "127.0.0.1"}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE}`
    );
  }
  const pool = mysqlPool;

  return {
    async run(sql, ...args) {
      const [result] = await pool.execute(sql, toParams(args));
      if (result && typeof result.insertId !== "undefined") {
        _lastInsertId = result.insertId;
      }
      return result;
    },
    async get(sql, ...args) {
      // Hỗ trợ truy vấn cũ lấy last_insert_rowid()
      if (/select\s+last_insert_rowid\(\)\s+as\s+id/i.test(sql)) {
        return { id: _lastInsertId ?? null };
      }
      const [rows] = await pool.execute(sql, toParams(args));
      return rows && rows[0] ? rows[0] : null;
    },
    async all(sql, ...args) {
      const [rows] = await pool.execute(sql, toParams(args));
      return rows || [];
    },
    async exec(sql) {
      const s = String(sql).trim().toUpperCase();
      if (s.startsWith("BEGIN")) return pool.query("START TRANSACTION");
      if (s.startsWith("COMMIT")) return pool.query("COMMIT");
      if (s.startsWith("ROLLBACK")) return pool.query("ROLLBACK");
      return pool.query(sql);
    },
    driver: "mysql",
  };
}

/** ===================== SQLite facade ===================== */
async function getSqliteFacade() {
  // Chỉ nạp sqlite khi thực sự dùng SQLite
  if (!sqliteOpen || !sqlite3Driver) {
    const { open } = await import("sqlite");
    const sqlite3 = await import("sqlite3");
    sqliteOpen = open;
    sqlite3Driver = sqlite3.Database;
  }

  const file = process.env.APP_DB || process.env.DB_PATH || "./data/data.sqlite";
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!sqliteDb) {
    sqliteDb = await sqliteOpen({ filename: file, driver: sqlite3Driver });
    console.log(`[DB] Using SQLite at ${path.resolve(file)}`);
  }

  return {
    async run(sql, ...args) {
      const r = await sqliteDb.run(sql, toParams(args));
      if (r?.lastID) _lastInsertId = r.lastID;
      return r;
    },
    async get(sql, ...args) {
      return sqliteDb.get(sql, toParams(args));
    },
    async all(sql, ...args) {
      return sqliteDb.all(sql, toParams(args));
    },
    async exec(sql) {
      return sqliteDb.exec(sql);
    },
    driver: "sqlite",
  };
}

/** ===================== Public entry ===================== */
export async function getDb() {
  return getMysqlFacade(); // luôn MySQL
}