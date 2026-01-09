/**
 * PostgreSQL Database Provider
 *
 * Provides a connection pool and query interface for PostgreSQL.
 * Implements the same API as the SQLite adapter for consistency.
 */

const { Pool } = require('pg');

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
    const result = await pool.query(sql, params);
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

  return {
    query,
    transaction,
    close,
    stats,
    // Expose raw pool for advanced use cases
    _pool: pool,
  };
}

module.exports = {
  createPool,
};
