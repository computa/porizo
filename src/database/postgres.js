/**
 * PostgreSQL Database Provider
 *
 * Provides a connection pool and query interface for PostgreSQL.
 * Implements the same API as the SQLite adapter for consistency.
 *
 * Features:
 * - Connection pooling with configurable limits
 * - Health checks for monitoring
 * - Query logging in development mode
 * - Backwards compatibility with prepare() API
 */

const { Pool } = require('pg');

// Query logging configuration
const LOG_QUERIES = process.env.DB_LOG_QUERIES === 'true' || process.env.NODE_ENV === 'development';
const LOG_SLOW_QUERIES_MS = parseInt(process.env.DB_LOG_SLOW_MS || '100', 10);

/**
 * Create a PostgreSQL connection pool
 *
 * @param {Object} config - PostgreSQL configuration
 * @param {string} [config.host] - Database host (default: POSTGRES_HOST env var or 'localhost')
 * @param {number} [config.port] - Database port (default: POSTGRES_PORT env var or 5432)
 * @param {string} [config.database] - Database name (default: POSTGRES_DB env var or 'porizo')
 * @param {string} [config.user] - Database user (default: POSTGRES_USER env var or 'porizo')
 * @param {string} [config.password] - Database password (default: POSTGRES_PASSWORD env var)
 * @param {number} [config.maxConnections] - Max pool connections (default: 10)
 * @returns {Object} Database instance with query(), transaction(), close() methods
 */
function createPool(config = {}) {
  const poolConfig = {
    host: config.host || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(config.port || process.env.POSTGRES_PORT || '5432', 10),
    database: config.database || process.env.POSTGRES_DB || 'porizo',
    user: config.user || process.env.POSTGRES_USER || 'porizo',
    password: config.password || process.env.POSTGRES_PASSWORD,
    max: config.maxConnections || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  // Support DATABASE_URL for connection string
  if (process.env.DATABASE_URL && !config.host) {
    poolConfig.connectionString = process.env.DATABASE_URL;
  }

  const pool = new Pool(poolConfig);

  // Handle pool errors
  pool.on('error', (err) => {
    console.error('[PostgreSQL] Pool error:', err.message);
  });

  /**
   * Execute a query and return results
   *
   * @param {string} sql - SQL query (use $1, $2, etc. for parameters)
   * @param {Array} [params] - Query parameters
   * @returns {Promise<{rows: Array}>} Query result with rows array
   */
  async function query(sql, params = []) {
    const startTime = LOG_QUERIES ? Date.now() : 0;

    const result = await pool.query(sql, params);

    if (LOG_QUERIES) {
      const duration = Date.now() - startTime;
      const sqlPreview = sql.replace(/\s+/g, ' ').slice(0, 80);
      if (duration >= LOG_SLOW_QUERIES_MS) {
        console.log(`[DB SLOW ${duration}ms] ${sqlPreview}...`);
      } else if (process.env.DB_LOG_ALL === 'true') {
        console.log(`[DB ${duration}ms] ${sqlPreview}`);
      }
    }

    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  }

  /**
   * Run a function within a database transaction
   *
   * @param {Function} fn - Async function to run within transaction (receives client)
   * @returns {Promise<*>} Result of the function
   */
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create a query function scoped to this client
      const clientQuery = async (sql, params = []) => {
        const result = await client.query(sql, params);
        return { rows: result.rows, rowCount: result.rowCount };
      };

      const result = await fn(clientQuery);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Close all connections in the pool
   */
  async function close() {
    await pool.end();
  }

  /**
   * Get pool statistics (for monitoring)
   */
  function stats() {
    return {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  }

  /**
   * Health check - verify database connectivity
   *
   * @param {number} [timeoutMs=5000] - Timeout in milliseconds
   * @returns {Promise<{healthy: boolean, latencyMs?: number, error?: string}>}
   */
  async function healthCheck(timeoutMs = 5000) {
    const startTime = Date.now();
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
        ),
      ]);

      try {
        await client.query('SELECT 1');
        const latencyMs = Date.now() - startTime;
        return { healthy: true, latencyMs };
      } finally {
        client.release();
      }
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Backwards compatibility: prepare() method
   *
   * Returns an object with get(), all(), run() methods that mirror
   * the SQLite API for existing server code.
   *
   * Note: For new code, prefer using query() directly for better
   * PostgreSQL compatibility.
   *
   * @param {string} sql - SQL query (can use ? placeholders, will be converted)
   * @returns {Object} Object with get(), all(), run() methods
   */
  function prepare(sql) {
    // Convert SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
    let paramIndex = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);

    return {
      /**
       * Get a single row
       */
      get: async (...params) => {
        const result = await query(pgSql, params);
        return result.rows[0];
      },

      /**
       * Get all rows
       */
      all: async (...params) => {
        const result = await query(pgSql, params);
        return result.rows;
      },

      /**
       * Execute a mutation (INSERT/UPDATE/DELETE)
       */
      run: async (...params) => {
        const result = await query(pgSql, params);
        return { changes: result.rowCount };
      },
    };
  }

  return {
    query,
    transaction,
    close,
    stats,
    healthCheck,
    // Backwards compatibility
    prepare,
    // Expose raw pool for advanced use cases
    _pool: pool,
  };
}

module.exports = {
  createPool,
};
