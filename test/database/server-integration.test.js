/**
 * Server Database Integration Tests
 *
 * Verifies that the server can start and operate with the PostgreSQL database.
 * Requires PostgreSQL to be running (npm run db:up)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Check if PostgreSQL is available
async function isPostgresAvailable() {
  try {
    const { getDatabase } = require('../../src/database/index.js');
    const db = await getDatabase({});
    await db.query('SELECT 1');
    await db.close();
    return true;
  } catch (err) {
    return false;
  }
}

describe('Server Database Integration', () => {
  let db;
  let postgresAvailable = false;

  before(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      console.log('[Server Integration Tests] PostgreSQL not available, skipping tests');
    }
  });

  after(async () => {
    if (db) {
      await db.close();
    }
  });

  test('getDatabase returns adapter with query method', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    const { getDatabase } = require('../../src/database/index.js');
    db = await getDatabase({
      migrationsDir: path.join(__dirname, '../../migrations'),
    });

    // New API: query() method
    assert.ok(typeof db.query === 'function', 'Should have query() method');

    // Backwards compat: prepare() method
    assert.ok(typeof db.prepare === 'function', 'Should have prepare() method for backwards compatibility');

    // Test query
    const result = await db.query('SELECT 1 + 1 as sum');
    assert.strictEqual(result.rows[0].sum, 2, 'query() should work');
  });

  test('database adapter works with server buildServer function', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    const { getDatabase } = require('../../src/database/index.js');
    db = await getDatabase({
      migrationsDir: path.join(__dirname, '../../migrations'),
    });

    // Test query pattern used by ensureUser
    const testUserId = 'test-server-integration-' + Date.now();
    const existing = await db.query('SELECT id FROM users WHERE id = $1', [testUserId]);

    if (existing.rows.length === 0) {
      await db.query(
        'INSERT INTO users (id, created_at) VALUES ($1, $2)',
        [testUserId, new Date().toISOString()]
      );
    }

    const user = await db.query('SELECT * FROM users WHERE id = $1', [testUserId]);
    assert.ok(user.rows.length > 0, 'Should be able to create and retrieve user');
    assert.strictEqual(user.rows[0].id, testUserId);

    // Cleanup
    await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
  });

  test('database adapter has healthCheck and stats methods', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    const { getDatabase } = require('../../src/database/index.js');
    db = await getDatabase({
      migrationsDir: path.join(__dirname, '../../migrations'),
    });

    // Test healthCheck
    assert.ok(typeof db.healthCheck === 'function', 'Should have healthCheck() method');
    const health = await db.healthCheck();
    assert.strictEqual(health.healthy, true, 'Health check should return healthy');
    assert.ok(typeof health.latencyMs === 'number', 'Health check should include latency');

    // Test stats
    assert.ok(typeof db.stats === 'function', 'Should have stats() method');
    const dbStats = db.stats();
    assert.ok(dbStats.totalCount >= 1, 'Stats should include connection count');
  });

  test('server can start with database abstraction layer', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    const { getDatabase } = require('../../src/database/index.js');
    const { buildServer } = require('../../src/server.js');
    const { createStorageProvider } = require('../../src/storage');

    db = await getDatabase({
      migrationsDir: path.join(__dirname, '../../migrations'),
    });

    const storage = createStorageProvider({ type: 'memory' });
    const config = {
      isProduction: false,
      storage: { type: 'memory' },
    };

    // This should not throw
    const app = buildServer({ db, config, storage });

    // Basic health check
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.ok, true, 'Health check should return ok: true');

    await app.close();
  });
});
