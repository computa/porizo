/**
 * Database Abstraction Layer
 *
 * Provides PostgreSQL database connection with connection pooling and migrations.
 * Use getDatabase() to get a database instance based on configuration.
 *
 * API:
 * - query(sql, params) - Returns { rows: [...] }
 * - transaction(fn) - Run function in transaction
 * - close() - Close connection
 *
 * Backwards Compatibility (for existing server code):
 * - prepare(sql).get(...params) - Get single row
 * - prepare(sql).all(...params) - Get all rows
 * - prepare(sql).run(...params) - Returns { changes: number }
 */

const path = require("path");

/**
 * Get a PostgreSQL database instance
 *
 * @param {Object} config - Configuration options
 * @param {string} [config.migrationsDir] - Path to migrations directory (uses pg/ subfolder)
 * @param {Object} [config.postgres] - PostgreSQL-specific config (host, port, database, user, password)
 * @returns {Promise<Object>} Database instance with query(), transaction(), close() methods
 */
async function getDatabase(config = {}) {
  const provider = config.provider || process.env.DB_PROVIDER || (process.env.NODE_ENV === "test" ? "sqlite" : "postgres");

  if (provider === "sqlite") {
    const { initDb } = require("./sqlite.js");
    const sqlitePath = config.dbPath || process.env.DB_PATH || ":memory:";
    const migrationsDir = config.migrationsDir || path.join(process.cwd(), "migrations");
    return initDb({ dbPath: sqlitePath, migrationsDir });
  }

  const { createPool, runMigrations } = require("./postgres.js");
  const db = createPool(config.postgres || {});

  if (config.migrationsDir) {
    const pgMigrationsDir = path.join(config.migrationsDir, "pg");
    await runMigrations(db, pgMigrationsDir);
  }

  return db;
}

module.exports = {
  getDatabase,
};
