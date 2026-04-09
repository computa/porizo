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
});
