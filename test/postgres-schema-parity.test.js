const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

describe("PostgreSQL schema parity", () => {
  it("includes poem share binding columns required by gift finalization", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "migrations",
      "pg",
      "083_poem_share_binding_columns.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    assert.match(
      sql,
      /ALTER TABLE poem_share_tokens\s+ADD COLUMN IF NOT EXISTS bound_device_id TEXT;/i
    );
  });

  it("includes DLQ auto reprocess column required by the job runner", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "migrations",
      "pg",
      "054_dlq_auto_reprocess.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    assert.match(
      sql,
      /ALTER TABLE dead_letter_queue\s+ADD COLUMN IF NOT EXISTS auto_reprocess_count INTEGER NOT NULL DEFAULT 0;/i
    );
  });

  it("includes a repair migration for drifted core workflow tables", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "migrations",
      "pg",
      "088_repair_core_workflow_tables.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    assert.match(sql, /CREATE TABLE IF NOT EXISTS users/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS tracks/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS track_versions/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS jobs/i);
    assert.match(sql, /ALTER TABLE tracks\s+DROP CONSTRAINT IF EXISTS tracks_funding_source_check;/i);
  });

  it("backfills additive parity for historical SQLite-only migrations", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "migrations",
      "pg",
      "122_migration_parity_backfill.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    assert.match(sql, /ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT;/i);
    assert.match(sql, /ALTER TABLE users ADD COLUMN IF NOT EXISTS onesignal_synced_at TEXT;/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS download_events/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS job_step_history/i);
    assert.match(sql, /timbre_blend_strategy/i);
    assert.match(sql, /elevenlabs_stability/i);
  });
});
