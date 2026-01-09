/**
 * Server Database Integration Tests
 *
 * Verifies that the server can start and operate with the database abstraction layer.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Server Database Integration', () => {
  const testDbPath = path.join(__dirname, 'test-server-integration.db');

  after(() => {
    // Cleanup test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('getDatabase returns adapter with prepare() method for backwards compatibility', async () => {
    const { getDatabase } = require('../../src/database/index.js');

    const db = await getDatabase({
      provider: 'sqlite',
      dbPath: testDbPath,
      migrationsDir: path.join(__dirname, '../../migrations'),
    });

    // New API: query() method
    assert.ok(typeof db.query === 'function', 'Should have query() method');

    // Backwards compat: prepare() method
    assert.ok(typeof db.prepare === 'function', 'Should have prepare() method for backwards compatibility');

    // Test prepare().get()
    const result = db.prepare('SELECT 1 + 1 as sum').get();
    assert.strictEqual(result.sum, 2, 'prepare().get() should work');

    // Test prepare().all()
    const rows = db.prepare('SELECT 1 as num UNION SELECT 2 as num').all();
    assert.strictEqual(rows.length, 2, 'prepare().all() should return array');

    // Test prepare().run()
    db.prepare('CREATE TABLE IF NOT EXISTS test_compat (id INTEGER PRIMARY KEY, value TEXT)').run();
    const insertResult = db.prepare('INSERT INTO test_compat (value) VALUES (?)').run('test');
    assert.ok(insertResult.changes >= 0, 'prepare().run() should return changes count');

    await db.close();
  });

  test('database adapter works with server buildServer function', async () => {
    const { getDatabase } = require('../../src/database/index.js');
    const { createStorageProvider } = require('../../src/storage');

    const db = await getDatabase({
      provider: 'sqlite',
      dbPath: testDbPath,
      migrationsDir: path.join(__dirname, '../../migrations'),
    });

    // buildServer expects db to have prepare() method
    // Let's simulate what buildServer does with db
    const testUserId = 'test-user-123';

    // Test query pattern used by ensureUser
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(testUserId);

    if (!existing) {
      db.prepare(
        'INSERT INTO users (id, created_at) VALUES (?, ?)'
      ).run(testUserId, new Date().toISOString());
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(testUserId);
    assert.ok(user, 'Should be able to create and retrieve user');
    assert.strictEqual(user.id, testUserId);

    await db.close();
  });

  test('server can start with database abstraction layer', async () => {
    const { getDatabase } = require('../../src/database/index.js');
    const { buildServer } = require('../../src/server.js');
    const { createStorageProvider } = require('../../src/storage');

    const db = await getDatabase({
      provider: 'sqlite',
      dbPath: testDbPath,
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
    await db.close();
  });
});
