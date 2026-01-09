/**
 * Database Migration Runner
 *
 * Tracks and applies SQL migrations for both SQLite and PostgreSQL.
 * Migrations are executed in order based on filename prefix (001_, 002_, etc.).
 *
 * Features:
 * - Version tracking in schema_migrations table
 * - Transaction-wrapped migrations (single migration per transaction)
 * - Idempotent execution (skips already-applied migrations)
 * - Support for both SQLite and PostgreSQL
 */

const fs = require('fs');
const path = require('path');

/**
 * Create a migration runner for the given database
 *
 * @param {Object} db - Database instance with query() and transaction() methods
 * @param {string} migrationsDir - Path to directory containing .sql migration files
 * @returns {Object} Migration runner with migrate(), getStatus(), etc.
 */
function createMigrationRunner(db, migrationsDir) {
  /**
   * Ensure the schema_migrations table exists
   * Uses 'id' column for backwards compatibility with existing db.js migrations
   */
  async function ensureMigrationsTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Get list of already-applied migration versions
   *
   * @returns {Promise<string[]>} Array of applied migration filenames
   */
  async function getAppliedMigrations() {
    await ensureMigrationsTable();
    const result = await db.query('SELECT id FROM schema_migrations ORDER BY id');
    return result.rows.map(row => row.id);
  }

  /**
   * Get all migration files from the migrations directory
   *
   * @returns {Array<{name: string, path: string}>} Sorted array of migration info
   */
  function getMigrationFiles() {
    if (!fs.existsSync(migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Alphabetical sort ensures 001_, 002_, etc. order

    return files.map(name => ({
      name,
      path: path.join(migrationsDir, name),
    }));
  }

  /**
   * Get pending migrations that haven't been applied yet
   *
   * @returns {Promise<Array<{name: string, path: string}>>} Pending migrations
   */
  async function getPendingMigrations() {
    const applied = await getAppliedMigrations();
    const all = getMigrationFiles();

    return all.filter(m => !applied.includes(m.name));
  }

  /**
   * Run a single migration
   *
   * @param {{name: string, path: string}} migration - Migration to run
   * @throws {Error} If migration fails (rolled back)
   */
  async function runMigration(migration) {
    const sql = fs.readFileSync(migration.path, 'utf8');

    await db.transaction(async (query) => {
      // Execute the migration SQL
      // Split by semicolons for multiple statements (SQLite needs this)
      // First, strip SQL comments (lines starting with --)
      const sqlWithoutComments = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');

      const statements = sqlWithoutComments
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        await query(statement);
      }

      // Record the migration as applied (uses 'id' for backwards compatibility)
      await query(
        'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
        [migration.name, new Date().toISOString()]
      );
    });
  }

  /**
   * Run all pending migrations
   *
   * @returns {Promise<{applied: number, migrations: string[]}>} Result summary
   */
  async function migrate() {
    await ensureMigrationsTable();

    const pending = await getPendingMigrations();
    const applied = [];

    for (const migration of pending) {
      await runMigration(migration);
      applied.push(migration.name);
    }

    return {
      applied: applied.length,
      migrations: applied,
    };
  }

  /**
   * Get migration status
   *
   * @returns {Promise<{applied: number, pending: number, appliedMigrations: string[], pendingMigrations: string[]}>}
   */
  async function getStatus() {
    await ensureMigrationsTable();

    const appliedMigrations = await getAppliedMigrations();
    const pendingMigrations = await getPendingMigrations();

    return {
      applied: appliedMigrations.length,
      pending: pendingMigrations.length,
      appliedMigrations,
      pendingMigrations: pendingMigrations.map(m => m.name),
    };
  }

  return {
    ensureMigrationsTable,
    getAppliedMigrations,
    getMigrationFiles,
    getPendingMigrations,
    runMigration,
    migrate,
    getStatus,
  };
}

module.exports = {
  createMigrationRunner,
};
