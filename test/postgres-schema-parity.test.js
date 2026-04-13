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
});
