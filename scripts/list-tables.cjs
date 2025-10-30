const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

(async () => {
  const db = await open({ filename: "./data/app.db", driver: sqlite3.Database });
  console.log("== All tables ==");
  console.log(await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"));

  console.log("== users columns ==");
  console.log(await db.all("PRAGMA table_info(users)"));
})();
