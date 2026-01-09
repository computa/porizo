/**
 * SQLite Database Adapter
 *
 * Wraps the existing sql.js implementation to provide the same API
 * as the PostgreSQL adapter for consistency.
 */

const { initDb } = require('../db.js');
const path = require('path');
const initSqlJs = require('sql.js');
const fs = require('fs');

/**
 * Initialize database with optional migrations
 * When migrationsDir is null, skip migration running entirely
 */
async function initDbWithOptionalMigrations({ dbPath, migrationsDir }) {
  if (migrationsDir) {
    // Use existing initDb which runs migrations
    return initDb({ dbPath, migrationsDir });
  }

  // Initialize without migrations - for testing or custom migration handling
  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });

  // Load or create database
  let rawDb;
  if (!dbPath || dbPath === ':memory:') {
    rawDb = new SQL.Database();
  } else {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      rawDb = new SQL.Database(fileBuffer);
    } else {
      rawDb = new SQL.Database();
    }
  }

  // Create minimal wrapper compatible with initDb output
  let dirty = false;
  const save = () => {
    if (dirty && dbPath && dbPath !== ':memory:') {
      const data = rawDb.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
      dirty = false;
    }
  };

  return {
    prepare: (sql) => ({
      get: (...params) => {
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        const hasRow = stmt.step();
        const row = hasRow ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      },
      all: (...params) => {
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      },
      run: (...params) => {
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
        dirty = true;
        return { changes: rawDb.getRowsModified() };
      },
    }),
    exec: (sql) => {
      rawDb.exec(sql);
      dirty = true;
    },
    save,
    close: () => {
      save();
      rawDb.close();
    },
    // Synchronous transaction (for compatibility with existing code)
    transaction: (fn) => {
      rawDb.exec('BEGIN TRANSACTION');
      try {
        const result = fn();
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

/**
 * Wrap the raw db with async transaction support
 * This matches the API of the full createSqliteAdapter
 */
function wrapWithAsyncTransaction(rawDb, dbPath) {
  const query = async (sql, params = []) => {
    const convertedSql = convertParameters(sql);
    const trimmedSql = sql.trim().toLowerCase();

    if (trimmedSql.startsWith('select') || trimmedSql.startsWith('with') || trimmedSql.startsWith('pragma')) {
      const rows = rawDb.prepare(convertedSql).all(...params);
      return { rows, rowCount: rows.length };
    } else if (trimmedSql.startsWith('create') || trimmedSql.startsWith('alter') || trimmedSql.startsWith('drop')) {
      // DDL statements - use exec() (sql.js doesn't handle DDL well with prepare)
      rawDb.exec(convertedSql);
      return { rows: [], rowCount: 0 };
    } else {
      const result = rawDb.prepare(convertedSql).run(...params);
      return { rows: [], rowCount: result.changes };
    }
  };

  const transaction = async (fn) => {
    rawDb.exec('BEGIN TRANSACTION');
    try {
      const result = await fn(query);
      rawDb.exec('COMMIT');
      rawDb.save();
      return result;
    } catch (err) {
      rawDb.exec('ROLLBACK');
      throw err;
    }
  };

  return {
    query,
    transaction,
    close: async () => rawDb.close(),
    save: () => rawDb.save(),
    _raw: rawDb,
  };
}

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
  // Use null check to allow explicitly skipping migrations
  const migrationsDir = config.migrationsDir !== undefined
    ? config.migrationsDir
    : path.join(process.cwd(), 'migrations');

  const db = await initDbWithOptionalMigrations({ dbPath, migrationsDir });

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

    if (trimmedSql.startsWith('select') || trimmedSql.startsWith('with') || trimmedSql.startsWith('pragma')) {
      // SELECT query - use all() to get rows
      const rows = db.prepare(convertedSql).all(...params);
      return { rows, rowCount: rows.length };
    } else if (trimmedSql.startsWith('create') || trimmedSql.startsWith('alter') || trimmedSql.startsWith('drop')) {
      // DDL statements - use exec() (sql.js doesn't handle DDL well with prepare)
      db.exec(convertedSql);
      return { rows: [], rowCount: 0 };
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
    // Backwards compatibility: expose prepare() directly
    // This allows existing code using db.prepare("SQL").get/all/run() to work unchanged
    prepare: (sql) => db.prepare(sql),
    // Expose exec() for DDL statements
    exec: (sql) => db.exec(sql),
    // Expose raw db for advanced usage
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
