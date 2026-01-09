/**
 * PostgreSQL Migration Tests
 *
 * Tests that the PostgreSQL migrations apply correctly.
 * Run with: npm test -- test/database/postgres-migration.test.js
 *
 * Note: These tests use SQLite to verify the migration SQL structure,
 * but with PostgreSQL-compatible syntax where possible.
 * Full PostgreSQL tests require Docker: docker-compose up -d
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('PostgreSQL Migration', () => {
  let db;
  let skipPostgres = false;
  const testDbPath = path.join(__dirname, 'test-postgres-migration.db');
  const postgresMigrationsDir = path.join(__dirname, '../../src/database/migrations/sql');

  before(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Check if PostgreSQL is available
    try {
      process.env.DB_PROVIDER = 'postgres';
      process.env.POSTGRES_HOST = 'localhost';
      process.env.POSTGRES_PORT = '5432';
      process.env.POSTGRES_DB = 'porizo_test';
      process.env.POSTGRES_USER = 'porizo';
      process.env.POSTGRES_PASSWORD = 'dev_password';

      const { createPool } = require('../../src/database/postgres.js');
      const pgDb = createPool({
        database: 'porizo_test',
      });
      await pgDb.query('SELECT 1');
      await pgDb.close();
    } catch (err) {
      console.log('[PostgreSQL Migration Tests] PostgreSQL not available, using SQLite fallback');
      skipPostgres = true;
    }
  });

  after(async () => {
    // Cleanup test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
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
      'billing_holds',
      'rate_limits',
      'share_events',
    ];

    for (const table of expectedTables) {
      assert.ok(
        sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `Migration should create ${table} table`
      );
    }
  });

  test('second migration adds poems, subscriptions, and billing tables', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '002_add_poems_subscriptions.sql');
    assert.ok(fs.existsSync(migrationPath), 'Second migration should exist');

    const sql = fs.readFileSync(migrationPath, 'utf8');

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
    assert.ok(sql.includes('verses JSONB'), 'poems should have verses JSONB column');
    assert.ok(sql.includes('auto_renew_enabled BOOLEAN'), 'subscriptions should have auto_renew_enabled');
    assert.ok(sql.includes('verification_response JSONB'), 'purchase_receipts should have verification_response');
  });

  test('PostgreSQL migration uses proper types', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Check for PostgreSQL-specific types
    assert.ok(sql.includes('TIMESTAMPTZ'), 'Should use TIMESTAMPTZ for timestamps');
    assert.ok(sql.includes('JSONB'), 'Should use JSONB for JSON data');
    assert.ok(sql.includes('SERIAL'), 'Should use SERIAL for auto-increment');
    assert.ok(sql.includes('BOOLEAN'), 'Should use BOOLEAN type');

    // Check for foreign key references
    assert.ok(sql.includes('REFERENCES users(id)'), 'Should have foreign key references');
    assert.ok(sql.includes('ON DELETE CASCADE'), 'Should have CASCADE deletes');
  });

  test('PostgreSQL migration creates indexes', async () => {
    const migrationPath = path.join(postgresMigrationsDir, '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Check for important indexes
    assert.ok(sql.includes('idx_jobs_status'), 'Should index jobs status');
    assert.ok(sql.includes('idx_tracks_user_id'), 'Should index tracks by user');
    assert.ok(sql.includes('idx_track_versions_track_id'), 'Should index track versions');
  });

  test('migration applies to PostgreSQL (requires Docker)', async (t) => {
    if (skipPostgres) {
      return t.skip('PostgreSQL not available');
    }

    const { createPool } = require('../../src/database/postgres.js');
    const { createMigrationRunner } = require('../../src/database/migrations/runner.js');

    // Create a test database connection
    const db = createPool({
      database: 'porizo_test',
    });

    // Drop existing tables for clean test
    await db.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO porizo;
      GRANT ALL ON SCHEMA public TO public;
    `);

    const runner = createMigrationRunner(db, postgresMigrationsDir);

    // Run migrations
    const result = await runner.migrate();
    assert.strictEqual(result.applied, 1, 'Should apply 1 migration');

    // Verify tables exist
    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tableNames = tables.rows.map(r => r.table_name);
    assert.ok(tableNames.includes('users'), 'users table should exist');
    assert.ok(tableNames.includes('tracks'), 'tracks table should exist');
    assert.ok(tableNames.includes('jobs'), 'jobs table should exist');
    assert.ok(tableNames.includes('schema_migrations'), 'schema_migrations should exist');

    await db.close();
  });
});
