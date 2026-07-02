/**
 * PostgreSQL Database Provider
 *
 * Provides a connection pool and query interface for PostgreSQL.
 *
 * Features:
 * - Connection pooling with configurable limits
 * - Health checks for monitoring
 * - Query logging in development mode
 * - Backwards compatibility with prepare() API
 */

const { Pool } = require("pg");

// Query logging configuration
const LOG_QUERIES =
  process.env.DB_LOG_QUERIES === "true" ||
  process.env.NODE_ENV === "development";
const LOG_SLOW_QUERIES_MS = parseInt(process.env.DB_LOG_SLOW_MS || "100", 10);

function sanitizeSchemaName(schema) {
  if (typeof schema !== "string") {
    return null;
  }
  const cleaned = schema.trim().replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned || null;
}

function convertQuestionMarkPlaceholders(sql, params = []) {
  if (typeof sql !== "string" || !sql.includes("?") || params.length === 0) {
    return { sql, params };
  }

  let index = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++index}`);
  return { sql: convertedSql, params };
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let singleQuote = false;
  let doubleQuote = false;
  let lineComment = false;
  let blockComment = false;
  let dollarQuoteTag = null;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      i += 1;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        blockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, i)) {
        current += dollarQuoteTag;
        i += dollarQuoteTag.length;
        dollarQuoteTag = null;
      } else {
        current += char;
        i += 1;
      }
      continue;
    }

    if (!singleQuote && !doubleQuote && char === "-" && next === "-") {
      current += char + next;
      lineComment = true;
      i += 2;
      continue;
    }

    if (!singleQuote && !doubleQuote && char === "/" && next === "*") {
      current += char + next;
      blockComment = true;
      i += 2;
      continue;
    }

    if (!singleQuote && !doubleQuote && char === "$") {
      const tagMatch = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (tagMatch) {
        dollarQuoteTag = tagMatch[0];
        current += dollarQuoteTag;
        i += dollarQuoteTag.length;
        continue;
      }
    }

    if (!doubleQuote && char === "'" && !singleQuote) {
      singleQuote = true;
      current += char;
      i += 1;
      continue;
    }

    if (singleQuote) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      if (char === "'") singleQuote = false;
      i += 1;
      continue;
    }

    if (!singleQuote && char === '"') {
      doubleQuote = !doubleQuote;
      current += char;
      i += 1;
      continue;
    }

    if (!singleQuote && !doubleQuote && char === ";") {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = "";
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  const finalStatement = current.trim();
  if (finalStatement.length > 0) statements.push(finalStatement);
  return statements;
}

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
 * @param {number} [config.connectionTimeoutMillis] - Connection timeout in milliseconds
 * @param {number} [config.idleTimeoutMillis] - Idle timeout in milliseconds
 * @returns {Object} Database instance with query(), transaction(), close() methods
 */
function createPool(config = {}) {
  const schema = sanitizeSchemaName(
    config.schema || process.env.POSTGRES_SCHEMA,
  );
  const poolConfig = {
    host: config.host || process.env.POSTGRES_HOST || "localhost",
    port: parseInt(config.port || process.env.POSTGRES_PORT || "5432", 10),
    database: config.database || process.env.POSTGRES_DB || "porizo",
    user: config.user || process.env.POSTGRES_USER || "porizo",
    password: config.password || process.env.POSTGRES_PASSWORD,
    max:
      config.maxConnections ||
      parseInt(process.env.DB_MAX_CONNECTIONS || "20", 10),
    idleTimeoutMillis:
      config.idleTimeoutMillis ||
      parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10),
    connectionTimeoutMillis:
      config.connectionTimeoutMillis ||
      parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || "5000", 10),
  };

  if (schema) {
    const existingOptions = poolConfig.options ? `${poolConfig.options} ` : "";
    poolConfig.options = `${existingOptions}-c search_path=${schema},public`;
  }

  // Support DATABASE_URL for connection string
  if (process.env.DATABASE_URL && !config.host) {
    poolConfig.connectionString = process.env.DATABASE_URL;
  }

  const pool = new Pool(poolConfig);

  // Handle pool errors
  pool.on("error", (err) => {
    console.error("[PostgreSQL] Pool error:", err.message);
  });

  /**
   * Execute a query and return results
   *
   * @param {string} sql - SQL query (use $1, $2, etc. for parameters)
   * @param {Array} [params] - Query parameters
   * @returns {Promise<{rows: Array}>} Query result with rows array
   */
  async function query(sql, params = []) {
    const converted = convertQuestionMarkPlaceholders(sql, params);
    const startTime = LOG_QUERIES ? Date.now() : 0;

    const result = await pool.query(converted.sql, converted.params);

    if (LOG_QUERIES) {
      const duration = Date.now() - startTime;
      const sqlPreview = converted.sql.replace(/\s+/g, " ").slice(0, 80);
      if (duration >= LOG_SLOW_QUERIES_MS) {
        console.log(`[DB SLOW ${duration}ms] ${sqlPreview}...`);
      } else if (process.env.DB_LOG_ALL === "true") {
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
      await client.query("BEGIN");

      // Create a query function scoped to this client
      const clientQuery = async (sql, params = []) => {
        const converted = convertQuestionMarkPlaceholders(sql, params);
        const result = await client.query(converted.sql, converted.params);
        return { rows: result.rows, rowCount: result.rowCount };
      };

      const result = await fn(clientQuery);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
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
          setTimeout(() => reject(new Error("Connection timeout")), timeoutMs),
        ),
      ]);

      try {
        await client.query("SELECT 1");
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
   * Returns an object with get(), all(), run() methods for
   * existing server code using the prepare() pattern.
   *
   * @param {string} sql - SQL query (can use ? placeholders, will be converted)
   * @returns {Object} Object with get(), all(), run() methods
   */
  function prepare(sql) {
    // Convert ? placeholders to PostgreSQL $1, $2, etc.
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

  /**
   * Execute raw SQL (for migrations, DDL, etc.)
   * Supports multiple statements separated by semicolons.
   */
  async function execSql(sql) {
    await pool.query(sql);
  }

  /**
   * Save function (no-op for PostgreSQL - auto-commits)
   */
  function save() {
    // PostgreSQL auto-commits, no explicit save needed
  }

  return {
    query,
    transaction,
    close,
    stats,
    healthCheck,
    exec: execSql,
    save,
    // Backwards compatibility
    prepare,
    // Expose raw pool for advanced use cases
    _pool: pool,
    // Database type flag for conditional SQL
    isPostgres: true,
  };
}

/**
 * Wait for the database to accept connections, retrying on transient failures.
 *
 * At boot on Railway, the private network (`*.railway.internal`) or the
 * Postgres instance itself can be momentarily unroutable, causing the first
 * connection to time out. Without a retry, that timeout throws out of
 * runMigrations, crashes start(), and the container restarts — often into the
 * same race — leaving the whole backend down (Cloudflare 502) indefinitely.
 *
 * This probes with a cheap `SELECT 1` and exponential backoff. It only guards
 * the "is the DB reachable?" question; migrations still run exactly once and
 * are never retried here.
 *
 * @param {Object} db - Database instance from createPool
 * @param {Object} [opts]
 * @param {number} [opts.maxAttempts] - Total attempts before giving up (default: DB_CONNECT_MAX_ATTEMPTS or 15)
 * @param {number} [opts.baseDelayMs] - Initial backoff delay (default: DB_CONNECT_BASE_DELAY_MS or 500)
 * @param {number} [opts.maxDelayMs] - Backoff cap (default: DB_CONNECT_MAX_DELAY_MS or 5000)
 * @param {Function} [opts.sleep] - Injectable sleep(ms) for testing
 * @param {Function} [opts.log] - Injectable logger for testing
 * @returns {Promise<void>} Resolves once a probe succeeds; rejects with the last error otherwise.
 */
async function waitForConnection(db, opts = {}) {
  const maxAttempts =
    opts.maxAttempts ||
    parseInt(process.env.DB_CONNECT_MAX_ATTEMPTS || "15", 10);
  const baseDelayMs =
    opts.baseDelayMs ||
    parseInt(process.env.DB_CONNECT_BASE_DELAY_MS || "500", 10);
  const maxDelayMs =
    opts.maxDelayMs ||
    parseInt(process.env.DB_CONNECT_MAX_DELAY_MS || "5000", 10);
  const sleep =
    opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = opts.log || ((msg) => console.log(msg));

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await db.query("SELECT 1");
      if (attempt > 1) {
        log(`[PostgreSQL] Connected after ${attempt} attempts`);
      }
      return;
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      log(
        `[PostgreSQL] Connection attempt ${attempt}/${maxAttempts} failed (${err.message}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Run migrations from a directory
 *
 * @param {Object} db - Database instance from createPool
 * @param {string} migrationsDir - Path to migrations directory
 */
async function runMigrations(db, migrationsDir) {
  const fs = require("fs");
  const path = require("path");

  // Create migrations table if not exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get applied migrations
  const { rows } = await db.query("SELECT id FROM schema_migrations");
  const appliedSet = new Set(rows.map((r) => r.id));

  // Get migration files
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    console.log(`[PostgreSQL] Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

    try {
      await db.transaction(async (query) => {
        const statements = splitSqlStatements(sql);
        for (const stmt of statements) {
          await query(stmt);
        }
        await query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      });
      console.log(`[PostgreSQL] Migration complete: ${file}`);
    } catch (err) {
      console.error(`[PostgreSQL] Migration failed: ${file}`, err.message);
      throw err;
    }
  }
}

module.exports = {
  createPool,
  runMigrations,
  waitForConnection,
  splitSqlStatements,
};
