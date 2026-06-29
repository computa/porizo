#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

const KNOWN_DRIFT = {
  // Historical local-only migrations. PostgreSQL receives their additive schema
  // and flag effects through pg/122_migration_parity_backfill.sql so new
  // low-number migrations do not run before the 088 repair migration.
  sqliteOnly: [
    "049_timbre_tint_v2_tuning.sql",
    "050_timbre_blend_strategies.sql",
    "051_voice_polish_quality.sql",
    "052_elevenlabs_voice_id.sql",
    "053_elevenlabs_tuning_and_missing_flags.sql",
    "055_singing_vocal_polish.sql",
    "067_onesignal_integration.sql",
    "071_download_attribution.sql",
    "072_step_history.sql",
  ],
  // Intentionally PostgreSQL-specific repair/destructive cleanup migrations.
  // SQLite keeps the legacy billing columns/table until the local test harness
  // and account-deletion fixtures are moved off them.
  postgresOnly: [
    "088_repair_core_workflow_tables.sql",
    "094_drop_legacy_credits_columns.sql",
    "095_drop_billing_holds.sql",
  ],
  legacyConsolidationSql: [],
};

function readSqlBasenames(relativeDir) {
  const dir = path.join(REPO_ROOT, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((name) => !rightSet.has(name));
}

function compareExact(label, actual, expected) {
  const unexpected = difference(actual, expected);
  const missingExpected = difference(expected, actual);
  const errors = [];

  if (unexpected.length > 0) {
    errors.push(`${label} has unreviewed entries: ${unexpected.join(", ")}`);
  }
  if (missingExpected.length > 0) {
    errors.push(`${label} allowlist is stale; expected entries are gone: ${missingExpected.join(", ")}`);
  }

  return errors;
}

function collectMigrationParity() {
  const sqlite = readSqlBasenames("migrations");
  const postgres = readSqlBasenames("migrations/pg");
  const legacyConsolidation = readSqlBasenames("src/database/migrations/sql");

  const sqliteOnly = difference(sqlite, postgres);
  const postgresOnly = difference(postgres, sqlite);

  return {
    sqliteCount: sqlite.length,
    postgresCount: postgres.length,
    legacyConsolidationCount: legacyConsolidation.length,
    sqliteOnly,
    postgresOnly,
    legacyConsolidation,
  };
}

function verifyMigrationParity() {
  const report = collectMigrationParity();
  const errors = [
    ...compareExact("SQLite-only migrations", report.sqliteOnly, KNOWN_DRIFT.sqliteOnly),
    ...compareExact("Postgres-only migrations", report.postgresOnly, KNOWN_DRIFT.postgresOnly),
    ...compareExact(
      "Legacy consolidation migrations",
      report.legacyConsolidation,
      KNOWN_DRIFT.legacyConsolidationSql,
    ),
  ];

  return { ok: errors.length === 0, errors, report };
}

function main() {
  const result = verifyMigrationParity();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectMigrationParity,
  verifyMigrationParity,
};
