/**
 * SQLite Database Adapter
 *
 * Wraps the existing sql.js implementation to provide the same API
 * as the PostgreSQL adapter for consistency.
 */

const { initDb } = require('../db.js');
const path = require('path');

/**
 * Create a SQLite database adapter
 *
 * @param {Object} config - SQLite configuration
 * @param {string} [config.dbPath] - Path to SQLite database file
 * @param {string} [config.migrationsDir] - Path to migrations directory
 * @returns {Promise<Object>} Database instance with query(), transaction(), close() methods
 */
async function createSqliteAdapter(config = {}) {
  const dbPath = config.dbPath || process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');
  const migrationsDir = config.migrationsDir || path.join(process.cwd(), 'migrations');

  const db = await initDb({ dbPath, migrationsDir });

  /**
   * Execute a query and return results
   *
   * SQLite uses ? placeholders, but we convert $1, $2 etc. for PostgreSQL compatibility.
   *
   * @param {string} sql - SQL query
   * @param {Array} [params] - Query parameters
   * @returns {Promise<{rows: Array}>} Query result with rows array
   */
  async function query(sql, params = []) {
    // Convert PostgreSQL-style parameters ($1, $2) to SQLite-style (?)
    const convertedSql = convertParameters(sql);

    // Determine query type based on SQL
    const trimmedSql = sql.trim().toLowerCase();

    if (trimmedSql.startsWith('select') || trimmedSql.startsWith('with')) {
      // SELECT query - use all() to get rows
      const rows = db.prepare(convertedSql).all(...params);
      return { rows, rowCount: rows.length };
    } else {
      // INSERT, UPDATE, DELETE - use run()
      const result = db.prepare(convertedSql).run(...params);
      return { rows: [], rowCount: result.changes };
    }
  }

  /**
   * Run a function within a database transaction
   *
   * For async functions, we manually manage BEGIN/COMMIT/ROLLBACK
   * since sql.js's transaction() is synchronous.
   *
   * @param {Function} fn - Async function to run within transaction (receives query function)
   * @returns {Promise<*>} Result of the function
   */
  async function transaction(fn) {
    // Start transaction using db.exec (sql.js method, not child_process)
    db.exec('BEGIN TRANSACTION');
    try {
      // Run the async function
      const result = await fn(query);
      // Commit on success
      db.exec('COMMIT');
      db.save();
      return result;
    } catch (err) {
      // Rollback on error
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Close the database connection
   */
  async function close() {
    db.close();
  }

  /**
   * Save database to disk (SQLite-specific)
   */
  function save() {
    db.save();
  }

  return {
    query,
    transaction,
    close,
    save,
    // Expose raw db for backward compatibility during migration
    _raw: db,
  };
}

/**
 * Convert PostgreSQL-style parameters ($1, $2) to SQLite-style (?)
 *
 * @param {string} sql - SQL with PostgreSQL-style parameters
 * @returns {string} SQL with SQLite-style parameters
 */
function convertParameters(sql) {
  // Replace $1, $2, etc. with ?
  // Also handle PostgreSQL type casts like $1::text
  return sql.replace(/\$(\d+)(?:::\w+)?/g, '?');
}

module.exports = {
  createSqliteAdapter,
  convertParameters,
};
