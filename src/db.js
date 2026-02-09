const path = require("node:path");
const { initDb: initSqliteDb } = require("./database/sqlite");

async function initDb(options = {}) {
  const {
    dbPath = process.env.DB_PATH || ":memory:",
    migrationsDir = path.join(process.cwd(), "migrations"),
  } = options;

  return initSqliteDb({ dbPath, migrationsDir });
}

module.exports = {
  initDb,
};
