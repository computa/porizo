#!/usr/bin/env node
/**
 * SQLite to PostgreSQL Data Migration Script
 *
 * Migrates all data from SQLite database to PostgreSQL.
 * Run with: node scripts/migrate-sqlite-to-postgres.js
 *
 * Prerequisites:
 * - PostgreSQL database must exist and have schema applied
 * - Run migrations first: npm run migrate:postgres
 *
 * Environment variables:
 * - SQLITE_PATH: Path to source SQLite database
 * - POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 *   or DATABASE_URL: PostgreSQL connection string
 *
 * Options:
 * --dry-run: Show what would be migrated without making changes
 * --tables=users,tracks: Only migrate specific tables
 */

const path = require('path');
const fs = require('fs');

// Tables in dependency order (foreign keys require this order)
const TABLES_IN_ORDER = [
  'users',
  'entitlements',
  'voice_profiles',
  'enrollment_sessions',
  'tracks',
  'track_versions',
  'jobs',
  'share_tokens',
  'share_access_log',
  'audit_logs',
  'billing_holds',
  'rate_limits',
  'share_events',
  'poems',
  'subscriptions',
  'purchase_receipts',
  'credit_transactions',
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tablesArg = args.find((a) => a.startsWith('--tables='));
  const selectedTables = tablesArg
    ? tablesArg.split('=')[1].split(',')
    : TABLES_IN_ORDER;

  console.log('='.repeat(60));
  console.log('SQLite to PostgreSQL Data Migration');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Initialize SQLite
  const sqlitePath =
    process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');
  if (!fs.existsSync(sqlitePath)) {
    console.error(`SQLite database not found at: ${sqlitePath}`);
    process.exit(1);
  }

  const { createSqliteAdapter } = require('../src/database/sqlite.js');
  const sqlite = await createSqliteAdapter({
    dbPath: sqlitePath,
    migrationsDir: null, // Don't run migrations
  });

  // Initialize PostgreSQL
  const { createPool } = require('../src/database/postgres.js');
  const postgres = createPool();

  // Verify PostgreSQL connection
  const healthCheck = await postgres.healthCheck();
  if (!healthCheck.healthy) {
    console.error('Failed to connect to PostgreSQL:', healthCheck.error);
    await sqlite.close();
    process.exit(1);
  }
  console.log(`Connected to PostgreSQL (${healthCheck.latencyMs}ms)\n`);

  // Migrate each table
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const table of TABLES_IN_ORDER) {
    if (!selectedTables.includes(table)) {
      continue;
    }

    try {
      // Check if table exists in SQLite
      const tableExists = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        )
        .get(table);

      if (!tableExists) {
        console.log(`[SKIP] ${table}: Table does not exist in SQLite`);
        results.skipped++;
        continue;
      }

      // Get row count
      const countResult = sqlite
        .prepare(`SELECT COUNT(*) as count FROM ${table}`)
        .get();
      const rowCount = countResult.count;

      if (rowCount === 0) {
        console.log(`[SKIP] ${table}: No data to migrate`);
        results.skipped++;
        continue;
      }

      console.log(`[MIGRATE] ${table}: ${rowCount} rows...`);

      if (!dryRun) {
        // Get all rows from SQLite
        const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();

        if (rows.length > 0) {
          // Get column names from first row
          const columns = Object.keys(rows[0]);

          // Build INSERT statement
          const placeholders = columns
            .map((_, i) => `$${i + 1}`)
            .join(', ');
          const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

          // Insert each row
          let inserted = 0;
          for (const row of rows) {
            const values = columns.map((col) => {
              const val = row[col];
              // Convert SQLite booleans (0/1) to PostgreSQL booleans
              if (val === 0 || val === 1) {
                // Check if it's likely a boolean column
                if (
                  col.startsWith('is_') ||
                  col.endsWith('_enabled') ||
                  col.endsWith('_allowed')
                ) {
                  return val === 1;
                }
              }
              return val;
            });

            try {
              await postgres.query(insertSql, values);
              inserted++;
            } catch (err) {
              // Log but continue on duplicate key errors
              if (!err.message.includes('duplicate key')) {
                console.error(`  Error inserting row: ${err.message}`);
              }
            }
          }

          console.log(`  Inserted ${inserted}/${rowCount} rows`);
        }
      }

      results.success++;
    } catch (err) {
      console.error(`[ERROR] ${table}: ${err.message}`);
      results.failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Success: ${results.success} tables`);
  console.log(`Skipped: ${results.skipped} tables`);
  console.log(`Failed: ${results.failed} tables`);

  // Cleanup
  await sqlite.close();
  await postgres.close();

  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
