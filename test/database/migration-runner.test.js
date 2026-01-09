/**
 * Migration Runner Tests
 *
 * Tests the database migration runner that tracks and applies migrations.
 * Run with: npm test -- test/database/migration-runner.test.js
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Migration Runner', () => {
  let db;
  let runner;
  const testDbPath = path.join(__dirname, 'test-migrations.db');
  const testMigrationsDir = path.join(__dirname, 'test-migrations');

  before(async () => {
    // Create test migrations directory
    if (!fs.existsSync(testMigrationsDir)) {
      fs.mkdirSync(testMigrationsDir, { recursive: true });
    }

    // Create test migration files
    fs.writeFileSync(
      path.join(testMigrationsDir, '001_create_test_table.sql'),
      `-- Migration: 001_create_test_table
CREATE TABLE test_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
    );

    fs.writeFileSync(
      path.join(testMigrationsDir, '002_add_description.sql'),
      `-- Migration: 002_add_description
ALTER TABLE test_items ADD COLUMN description TEXT;
`
    );
  });

  after(async () => {
    // Cleanup test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    // Cleanup test migrations
    if (fs.existsSync(testMigrationsDir)) {
      fs.rmSync(testMigrationsDir, { recursive: true });
    }
  });

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Get fresh database and runner for each test
    const { createSqliteAdapter } = require('../../src/database/sqlite.js');
    db = await createSqliteAdapter({
      dbPath: testDbPath,
      migrationsDir: null, // Don't run auto migrations
    });

    const { createMigrationRunner } = require('../../src/database/migrations/runner.js');
    runner = createMigrationRunner(db, testMigrationsDir);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  test('creates schema_migrations table on first run', async () => {
    await runner.ensureMigrationsTable();

    const result = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    );
    assert.strictEqual(result.rows.length, 1, 'schema_migrations table should exist');
  });

  test('lists pending migrations', async () => {
    await runner.ensureMigrationsTable();

    const pending = await runner.getPendingMigrations();
    assert.strictEqual(pending.length, 2, 'Should have 2 pending migrations');
    assert.strictEqual(pending[0].name, '001_create_test_table.sql');
    assert.strictEqual(pending[1].name, '002_add_description.sql');
  });

  test('runs a single migration', async () => {
    await runner.ensureMigrationsTable();

    const pending = await runner.getPendingMigrations();
    await runner.runMigration(pending[0]);

    // Verify migration was recorded
    const applied = await db.query('SELECT * FROM schema_migrations');
    assert.strictEqual(applied.rows.length, 1);
    assert.strictEqual(applied.rows[0].id, '001_create_test_table.sql');

    // Verify table was created
    const tables = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='test_items'"
    );
    assert.strictEqual(tables.rows.length, 1, 'test_items table should exist');
  });

  test('runs all pending migrations', async () => {
    await runner.migrate();

    // Verify both migrations were recorded
    const applied = await db.query('SELECT * FROM schema_migrations ORDER BY id');
    assert.strictEqual(applied.rows.length, 2);
    assert.strictEqual(applied.rows[0].id, '001_create_test_table.sql');
    assert.strictEqual(applied.rows[1].id, '002_add_description.sql');

    // Verify table has description column
    const result = await db.query('PRAGMA table_info(test_items)');
    const columns = result.rows.map(r => r.name);
    assert.ok(columns.includes('description'), 'description column should exist');
  });

  test('skips already applied migrations', async () => {
    // Run migrations once
    await runner.migrate();

    // Run again - should be idempotent
    const result = await runner.migrate();
    assert.strictEqual(result.applied, 0, 'Should not apply any migrations on second run');

    // Verify still only 2 records
    const applied = await db.query('SELECT * FROM schema_migrations');
    assert.strictEqual(applied.rows.length, 2);
  });

  test('returns migration status', async () => {
    const statusBefore = await runner.getStatus();
    assert.strictEqual(statusBefore.applied, 0);
    assert.strictEqual(statusBefore.pending, 2);

    await runner.migrate();

    const statusAfter = await runner.getStatus();
    assert.strictEqual(statusAfter.applied, 2);
    assert.strictEqual(statusAfter.pending, 0);
  });

  test('handles migration errors gracefully', async () => {
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
