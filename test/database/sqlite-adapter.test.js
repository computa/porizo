/**
 * SQLite Adapter Tests
 *
 * Tests the database abstraction layer with SQLite backend.
 * Run with: npm test -- test/database/sqlite-adapter.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('SQLite Adapter', () => {
  let db;
  const testDbPath = path.join(__dirname, 'test-sqlite.db');

  before(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Set environment for sqlite
    process.env.DB_PROVIDER = 'sqlite';

    const { getDatabase } = require('../../src/database/index.js');
    db = await getDatabase({
      provider: 'sqlite',
      dbPath: testDbPath,
      migrationsDir: path.join(process.cwd(), 'migrations'),
    });
  });

  after(async () => {
    if (db) {
      await db.close();
    }
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('connects to SQLite and executes query', async () => {
    const result = await db.query('SELECT 1 as test');
    assert.strictEqual(result.rows[0].test, 1);
  });

  test('database abstraction exposes query method', async () => {
    assert.ok(typeof db.query === 'function', 'db.query should be a function');
  });

  test('database abstraction exposes transaction method', async () => {
    assert.ok(typeof db.transaction === 'function', 'db.transaction should be a function');
  });

  test('can execute parameterized query with SQLite syntax', async () => {
    const result = await db.query('SELECT ? as name', ['Porizo']);
    assert.strictEqual(result.rows[0].name, 'Porizo');
  });

  test('can execute parameterized query with PostgreSQL syntax', async () => {
    // Test that $1, $2 syntax is converted to ?
    const result = await db.query('SELECT $1 as name', ['Porizo']);
    assert.strictEqual(result.rows[0].name, 'Porizo');
  });

  test('returns proper result structure', async () => {
    const result = await db.query('SELECT 1 as a, 2 as b');
    assert.ok(Array.isArray(result.rows), 'result.rows should be an array');
    assert.ok(result.rows.length > 0, 'result.rows should have at least one row');
    assert.strictEqual(result.rows[0].a, 1);
    assert.strictEqual(result.rows[0].b, 2);
  });

  test('can query existing tables from migrations', async () => {
    const result = await db.query('SELECT name FROM sqlite_master WHERE type="table" AND name="users"');
    assert.strictEqual(result.rows.length, 1, 'users table should exist from migrations');
  });

  test('transaction commits on success', async () => {
    // Create a test table
    await db.query('CREATE TABLE IF NOT EXISTS test_tx (id INTEGER PRIMARY KEY, value TEXT)');

    // Insert within transaction
    await db.transaction(async (query) => {
      await query('INSERT INTO test_tx (id, value) VALUES (?, ?)', [1, 'test']);
    });

    // Verify insert was committed
    const result = await db.query('SELECT value FROM test_tx WHERE id = ?', [1]);
    assert.strictEqual(result.rows[0].value, 'test');

    // Cleanup
    await db.query('DROP TABLE test_tx');
  });

  test('transaction rolls back on error', async () => {
    // Create a test table
    await db.query('CREATE TABLE IF NOT EXISTS test_rollback (id INTEGER PRIMARY KEY, value TEXT)');

    try {
      await db.transaction(async (query) => {
        await query('INSERT INTO test_rollback (id, value) VALUES (?, ?)', [1, 'should-rollback']);
        throw new Error('Intentional error');
      });
    } catch (err) {
      // Expected
    }

    // Verify insert was rolled back
    const result = await db.query('SELECT * FROM test_rollback WHERE id = ?', [1]);
    assert.strictEqual(result.rows.length, 0, 'Row should not exist after rollback');

    // Cleanup
    await db.query('DROP TABLE test_rollback');
  });
});
