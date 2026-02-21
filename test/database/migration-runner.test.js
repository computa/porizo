/**
 * Migration Runner Tests
 *
 * Tests the database migration runner that tracks and applies migrations.
 * Requires PostgreSQL to be running (npm run db:up)
 * Run with: npm test -- test/database/migration-runner.test.js
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Check if PostgreSQL is available
async function isPostgresAvailable() {
  try {
    const { createPool } = require('../../src/database/postgres.js');
    const db = createPool({});
    await db.query('SELECT 1');
    await db.close();
    return true;
  } catch (err) {
    return false;
  }
}

describe('Migration Runner', () => {
  let db;
  let runner;
  let postgresAvailable = false;
  let testMigrationsDir;
  const testSchema = 'test_migration_runner_' + Date.now();

  before(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      console.log('[Migration Runner Tests] PostgreSQL not available, skipping tests');
      return;
    }

    // Use a unique temp migration directory per test run to avoid stale files
    // from interrupted runs affecting pending/applied counts.
    testMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'porizo-migration-runner-'));

    const { createPool } = require('../../src/database/postgres.js');
    const adminDb = createPool({});
    await adminDb.query(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
    await adminDb.close();

    // Create test migration files (PostgreSQL compatible)
    fs.writeFileSync(
      path.join(testMigrationsDir, '001_create_test_table.sql'),
      `-- Migration: 001_create_test_table
CREATE TABLE IF NOT EXISTS test_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
    );

    fs.writeFileSync(
      path.join(testMigrationsDir, '002_add_description.sql'),
      `-- Migration: 002_add_description
ALTER TABLE test_items ADD COLUMN IF NOT EXISTS description TEXT;
`
    );
  });

  after(async () => {
    // Cleanup test migrations
    if (testMigrationsDir && fs.existsSync(testMigrationsDir)) {
      fs.rmSync(testMigrationsDir, { recursive: true });
    }

    if (postgresAvailable) {
      const { createPool } = require('../../src/database/postgres.js');
      const adminDb = createPool({});
      await adminDb.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await adminDb.close();
    }
  });

  beforeEach(async () => {
    if (!postgresAvailable) return;

    // Get fresh database and runner for each test
    const { createPool } = require('../../src/database/postgres.js');
    db = createPool({ schema: testSchema, maxConnections: 1 });

    // Clean up test tables from previous runs
    await db.query('DROP TABLE IF EXISTS test_items CASCADE');
    await db.query('DROP TABLE IF EXISTS schema_migrations CASCADE');

    const { createMigrationRunner } = require('../../src/database/migrations/runner.js');
    runner = createMigrationRunner(db, testMigrationsDir);
  });

  afterEach(async () => {
    if (db) {
      // Clean up
      await db.query('DROP TABLE IF EXISTS test_items CASCADE').catch(() => {});
      await db.query('DROP TABLE IF EXISTS schema_migrations CASCADE').catch(() => {});
      await db.close();
    }
  });

  test('creates schema_migrations table on first run', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    await runner.ensureMigrationsTable();

    const result = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'schema_migrations'"
    );
    assert.strictEqual(result.rows.length, 1, 'schema_migrations table should exist');
  });

  test('lists pending migrations', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    await runner.ensureMigrationsTable();

    const pending = await runner.getPendingMigrations();
    assert.strictEqual(pending.length, 2, 'Should have 2 pending migrations');
    assert.strictEqual(pending[0].name, '001_create_test_table.sql');
    assert.strictEqual(pending[1].name, '002_add_description.sql');
  });

  test('runs a single migration', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    await runner.ensureMigrationsTable();

    const pending = await runner.getPendingMigrations();
    await runner.runMigration(pending[0]);

    // Verify migration was recorded
    const applied = await db.query('SELECT * FROM schema_migrations');
    assert.strictEqual(applied.rows.length, 1);
    assert.strictEqual(applied.rows[0].id, '001_create_test_table.sql');

    // Verify table was created
    const tables = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'test_items'"
    );
    assert.strictEqual(tables.rows.length, 1, 'test_items table should exist');
  });

  test('runs all pending migrations', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    await runner.migrate();

    // Verify both migrations were recorded
    const applied = await db.query('SELECT * FROM schema_migrations ORDER BY id');
    assert.strictEqual(applied.rows.length, 2);
    assert.strictEqual(applied.rows[0].id, '001_create_test_table.sql');
    assert.strictEqual(applied.rows[1].id, '002_add_description.sql');

    // Verify table has description column
    const result = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'test_items'"
    );
    const columns = result.rows.map(r => r.column_name);
    assert.ok(columns.includes('description'), 'description column should exist');
  });

  test('skips already applied migrations', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    // Run migrations once
    await runner.migrate();

    // Run again - should be idempotent
    const result = await runner.migrate();
    assert.strictEqual(result.applied, 0, 'Should not apply any migrations on second run');

    // Verify still only 2 records
    const applied = await db.query('SELECT * FROM schema_migrations');
    assert.strictEqual(applied.rows.length, 2);
  });

  test('returns migration status', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    const statusBefore = await runner.getStatus();
    assert.strictEqual(statusBefore.applied, 0);
    assert.strictEqual(statusBefore.pending, 2);

    await runner.migrate();

    const statusAfter = await runner.getStatus();
    assert.strictEqual(statusAfter.applied, 2);
    assert.strictEqual(statusAfter.pending, 0);
  });

  test('handles migration errors gracefully', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    // Create a bad migration
    fs.writeFileSync(
      path.join(testMigrationsDir, '003_bad_migration.sql'),
      'CREATE TABLE this is invalid sql;'
    );

    await runner.ensureMigrationsTable();

    // Run first two migrations
    const pending = await runner.getPendingMigrations();
    await runner.runMigration(pending[0]);
    await runner.runMigration(pending[1]);

    // Third migration should fail
    const allPending = await runner.getPendingMigrations();
    await assert.rejects(
      async () => runner.runMigration(allPending[0]),
      /syntax error|near/i,
      'Should throw on invalid SQL'
    );

    // Verify bad migration was NOT recorded
    const applied = await db.query('SELECT * FROM schema_migrations');
    assert.strictEqual(applied.rows.length, 2, 'Bad migration should not be recorded');

    // Cleanup bad migration
    fs.unlinkSync(path.join(testMigrationsDir, '003_bad_migration.sql'));
  });
});
