/**
 * PostgreSQL Connection Tests
 *
 * Tests the database abstraction layer's ability to connect to PostgreSQL.
 * Run with: npm test -- test/database/postgres-connection.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

describe('PostgreSQL Connection', () => {
  let db;

  before(async () => {
    // Set environment for postgres
    process.env.DB_PROVIDER = 'postgres';
    process.env.POSTGRES_HOST = 'localhost';
    process.env.POSTGRES_PORT = '5432';
    process.env.POSTGRES_DB = 'porizo';
    process.env.POSTGRES_USER = 'porizo';
    process.env.POSTGRES_PASSWORD = 'dev_password';

    // Import database module (will fail until implemented)
    const { getDatabase } = require('../../src/database/index.js');
    db = await getDatabase({ provider: 'postgres' });
  });

  after(async () => {
    if (db && db.close) {
      await db.close();
    }
  });

  test('connects to PostgreSQL and executes query', async () => {
    const result = await db.query('SELECT 1 as test');
    assert.strictEqual(result.rows[0].test, 1);
  });

  test('database abstraction exposes query method', async () => {
    assert.ok(typeof db.query === 'function', 'db.query should be a function');
  });

  test('database abstraction exposes transaction method', async () => {
    assert.ok(typeof db.transaction === 'function', 'db.transaction should be a function');
  });

  test('can execute parameterized query', async () => {
    const result = await db.query('SELECT $1::text as name', ['Porizo']);
    assert.strictEqual(result.rows[0].name, 'Porizo');
  });

  test('returns proper result structure', async () => {
    const result = await db.query('SELECT 1 as a, 2 as b');
    assert.ok(Array.isArray(result.rows), 'result.rows should be an array');
    assert.ok(result.rows.length > 0, 'result.rows should have at least one row');
    assert.strictEqual(result.rows[0].a, 1);
    assert.strictEqual(result.rows[0].b, 2);
  });
});
