/**
 * Database Abstraction Layer
 *
 * Provides a unified interface for both SQLite (development) and PostgreSQL (production).
 * Use getDatabase() to get a database instance based on configuration.
 *
 * API (new code should use these):
 * - query(sql, params) - Returns { rows: [...] }
 * - transaction(fn) - Run function in transaction
 * - close() - Close connection
 *
 * Backwards Compatibility (for existing server code):
 * - prepare(sql).get(...params) - Get single row
 * - prepare(sql).all(...params) - Get all rows
 * - prepare(sql).run(...params) - Returns { changes: number }
 *
 * New code should prefer query() for better PostgreSQL compatibility.
 */

const path = require('path');

/**
 * Get a database instance based on configuration
 *
 * @param {Object} config - Configuration options
 * @param {string} [config.provider] - 'sqlite' or 'postgres' (defaults to DB_PROVIDER env var or 'sqlite')
 * @param {string} [config.dbPath] - Path for SQLite database
 * @param {string} [config.migrationsDir] - Path to migrations directory (SQLite uses this directly, PostgreSQL uses pg/ subfolder)
 * @param {Object} [config.postgres] - PostgreSQL-specific config (host, port, database, user, password)
 * @returns {Promise<Object>} Database instance with query(), transaction(), close() methods
 */
async function getDatabase(config = {}) {
  const provider = config.provider || process.env.DB_PROVIDER || 'sqlite';

  if (provider === 'postgres') {
    const { createPool, runMigrations } = require('./postgres.js');
    const db = createPool(config.postgres || {});

    // Run PostgreSQL migrations if migrationsDir is provided
    if (config.migrationsDir) {
      const pgMigrationsDir = path.join(config.migrationsDir, 'pg');
      await runMigrations(db, pgMigrationsDir);
    }

    return db;
  }

  // Default to SQLite - use existing initDb which handles migrations
  const { initDb } = require('../db.js');
  return initDb({
    dbPath: config.dbPath,
    migrationsDir: config.migrationsDir,
  });
}

module.exports = {
  getDatabase,
};
