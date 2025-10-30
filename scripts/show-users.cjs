const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
(async () => {
  const db = await open({ filename: process.env.DB_PATH || "./data/app.db", driver: sqlite3.Database });
  console.log(await db.all("SELECT id, username, email, role, status, length(password_hash) AS phlen FROM users"));
})();
