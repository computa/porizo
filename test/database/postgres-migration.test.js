/**
 * PostgreSQL Migration Tests
 *
 * Tests that the PostgreSQL migrations apply correctly.
 * Run with: npm test -- test/database/postgres-migration.test.js
 *
 * Static checks read canonical migrations/pg files. The apply test requires
 * Docker/PostgreSQL and is skipped when Postgres is unavailable.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('PostgreSQL Migration', () => {
  let skipPostgres = false;
  const postgresMigrationsDir = path.join(__dirname, '../../migrations/pg');
  const testSchema = `migration_test_${Date.now()}`;

  before(async () => {
    // Check if PostgreSQL is available
    try {
      process.env.DB_PROVIDER = 'postgres';
      process.env.POSTGRES_HOST = 'localhost';
      process.env.POSTGRES_PORT = '5432';
      process.env.POSTGRES_DB = 'porizo';
      process.env.POSTGRES_USER = 'porizo';
      process.env.POSTGRES_PASSWORD = 'dev_password';

      const { createPool } = require('../../src/database/postgres.js');
      const pgDb = createPool({
        database: 'porizo',
      });
      await pgDb.query('SELECT 1');
      await pgDb.close();
    } catch (err) {
      console.log('[PostgreSQL Migration Tests] PostgreSQL not available, using SQLite fallback');
      skipPostgres = true;
    }
  });

  test('PostgreSQL migration file exists and has valid SQL', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '001_init.sql');
    assert.ok(fs.existsSync(migrationPath), 'PostgreSQL migration file should exist');

    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(sql.length > 1000, 'Migration should have substantial content');
    assert.ok(sql.includes('CREATE TABLE'), 'Migration should create tables');
    assert.ok(sql.includes('users'), 'Migration should create users table');
    assert.ok(sql.includes('tracks'), 'Migration should create tracks table');
    assert.ok(sql.includes('jobs'), 'Migration should create jobs table');
  });

  test('PostgreSQL migration contains all expected tables', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    const expectedTables = [
      'users',
      'voice_profiles',
      'enrollment_sessions',
      'tracks',
      'track_versions',
      'jobs',
      'share_tokens',
      'share_access_log',
      'audit_logs',
      'entitlements',
      'rate_limits',
    ];

    for (const table of expectedTables) {
      assert.ok(
        sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `Migration should create ${table} table`
      );
    }
  });

  test('moderation details migration adds share_events audit table', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '011_add_moderation_details.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(
      sql.includes('CREATE TABLE IF NOT EXISTS share_events'),
      'Migration should create share_events table',
    );
    assert.ok(
      sql.includes('idx_share_events_key'),
      'Migration should index share_events event key lookup',
    );
  });

  test('canonical migrations add poems, subscriptions, and billing tables', async () => {
    const poemMigrationPath = path.join(postgresMigrationsDir, '015_add_poems.sql');
    const subscriptionMigrationPath = path.join(postgresMigrationsDir, '016_add_subscriptions.sql');
    const billingMigrationPath = path.join(postgresMigrationsDir, '018_add_subscription_billing_columns.sql');

    assert.ok(fs.existsSync(poemMigrationPath), 'Poems migration should exist');
    assert.ok(fs.existsSync(subscriptionMigrationPath), 'Subscriptions migration should exist');
    assert.ok(fs.existsSync(billingMigrationPath), 'Subscription billing migration should exist');

    const sql = [
      fs.readFileSync(poemMigrationPath, 'utf8'),
      fs.readFileSync(subscriptionMigrationPath, 'utf8'),
      fs.readFileSync(billingMigrationPath, 'utf8'),
    ].join('\n');

    const expectedTables = [
      'poems',
      'subscriptions',
      'purchase_receipts',
      'credit_transactions',
    ];

    for (const table of expectedTables) {
      assert.ok(
        sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `Migration should create ${table} table`
      );
    }

    // Check for important columns
    assert.ok(sql.includes('verses TEXT'), 'poems should have verses column');
    assert.ok(sql.includes('auto_renew_enabled INTEGER'), 'subscriptions should have auto_renew_enabled');
    assert.ok(sql.includes('verification_response TEXT'), 'purchase_receipts should have verification_response');
    assert.ok(sql.includes('is_in_billing_retry'), 'subscriptions should track billing retry');
  });

  test('PostgreSQL migration uses proper types', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Canonical production migrations use portable TEXT/INTEGER storage in early schema files.
    assert.ok(sql.includes('created_at TEXT NOT NULL'), 'Should define text timestamps in base schema');
    assert.ok(sql.includes('params_json TEXT'), 'Should define JSON payload columns');
    assert.ok(sql.includes('BIGINT'), 'Should use BIGINT for rate-limit windows');
    assert.ok(sql.includes('INTEGER'), 'Should use INTEGER counters');
  });

  test('PostgreSQL migration creates indexes', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Check for important indexes
    assert.ok(sql.includes('idx_jobs_track_version'), 'Should index jobs by track version');
    assert.ok(sql.includes('idx_track_versions_track_id'), 'Should index track versions');
    assert.ok(sql.includes('idx_share_access_token'), 'Should index share access by token');
  });

  test('migration applies to PostgreSQL (requires Docker)', async (t) => {
    if (skipPostgres) {
      return t.skip('PostgreSQL not available');
    }

    const { createPool, runMigrations } = require('../../src/database/postgres.js');

    // Create a test database connection
    const db = createPool({
      database: 'porizo',
      schema: testSchema,
    });

    // Create an isolated schema so the test does not require ownership of public.
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS ${testSchema};
    `);

    try {
      await runMigrations(db, postgresMigrationsDir);

      // Verify tables exist in the isolated schema
      const tables = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `, [testSchema]);

      const tableNames = tables.rows.map(r => r.table_name);
      assert.ok(tableNames.includes('users'), 'users table should exist');
      assert.ok(tableNames.includes('tracks'), 'tracks table should exist');
      assert.ok(tableNames.includes('jobs'), 'jobs table should exist');
      assert.ok(tableNames.includes('schema_migrations'), 'schema_migrations should exist');

      const applied = await db.query('SELECT COUNT(*) AS count FROM schema_migrations');
      assert.ok(Number(applied.rows[0].count) >= 1, 'Should apply at least one migration');
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await db.close();
    }
  });
});
