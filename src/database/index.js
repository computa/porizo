/**
 * Database Abstraction Layer
 *
 * Provides a unified interface for both SQLite (development) and PostgreSQL (production).
 * Use getDatabase() to get a database instance based on configuration.
 *
 * API:
 * - query(sql, params) - Execute query, returns { rows: [...] }
 * - transaction(fn) - Run function in transaction
 * - close() - Close connection
 */

/**
 * Get a database instance based on configuration
 *
 * @param {Object} config - Configuration options
 * @param {string} [config.provider] - 'sqlite' or 'postgres' (defaults to DB_PROVIDER env var or 'sqlite')
 * @param {string} [config.dbPath] - Path for SQLite database
 * @param {string} [config.migrationsDir] - Path to migrations directory
 * @param {Object} [config.postgres] - PostgreSQL-specific config (host, port, database, user, password)
 * @returns {Promise<Object>} Database instance with query(), transaction(), close() methods
 */
async function getDatabase(config = {}) {
  const provider = config.provider || process.env.DB_PROVIDER || 'sqlite';

  if (provider === 'postgres') {
    const { createPool } = require('./postgres.js');
    return createPool(config.postgres || {});
  }

  // Default to SQLite
  const { createSqliteAdapter } = require('./sqlite.js');
  return createSqliteAdapter(config);
}

module.exports = {
  getDatabase,
};
