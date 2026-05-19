/**
 * Migration 113 — artwork_vars_json / artwork_provider / artwork_prompt_version
 *
 * Verifies the sqlite mirror adds the columns track_versions needs for the
 * lyrics-aware bounded-vocab artwork redesign. Tests use the in-memory sqlite
 * adapter so the full migration chain applies before we assert column shape.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../../src/database/sqlite.js");

async function createTestDb() {
  return initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(__dirname, "../../migrations"),
  });
}

test("migration 113 adds artwork_vars_json column to track_versions", async () => {
  const db = await createTestDb();
  const cols = db.prepare("PRAGMA table_info(track_versions)").all();
  const names = cols.map((c) => c.name);
  assert.ok(names.includes("artwork_vars_json"), "artwork_vars_json missing");
  assert.ok(names.includes("artwork_provider"), "artwork_provider missing");
  assert.ok(
    names.includes("artwork_prompt_version"),
    "artwork_prompt_version missing",
  );
  await db.close();
});
