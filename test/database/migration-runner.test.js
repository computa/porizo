/**
 * PostgreSQL runMigrations tests.
 *
 * These cover the live migration runner in src/database/postgres.js using a
 * temporary migration directory. The legacy src/database/migrations runner was
 * production-dead and should not be reintroduced.
 */

const { after, afterEach, before, beforeEach, describe, test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function isPostgresAvailable() {
  try {
    const { createPool } = require("../../src/database/postgres.js");
    const db = createPool({});
    await db.query("SELECT 1");
    await db.close();
    return true;
  } catch (err) {
    return false;
  }
}

describe("PostgreSQL runMigrations", () => {
  let db;
  let postgresAvailable = false;
  let testMigrationsDir;
  const testSchema = `test_migration_runner_${Date.now()}`;

  before(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      console.log("[Migration Runner Tests] PostgreSQL not available, skipping tests");
      return;
    }

    testMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-migration-runner-"));

    const { createPool } = require("../../src/database/postgres.js");
    const adminDb = createPool({});
    await adminDb.query(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
    await adminDb.close();

    fs.writeFileSync(
      path.join(testMigrationsDir, "001_create_test_table.sql"),
      `CREATE TABLE IF NOT EXISTS test_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`,
    );

    fs.writeFileSync(
      path.join(testMigrationsDir, "002_add_description.sql"),
      "ALTER TABLE test_items ADD COLUMN IF NOT EXISTS description TEXT;\n",
    );
  });

  after(async () => {
    if (testMigrationsDir && fs.existsSync(testMigrationsDir)) {
      fs.rmSync(testMigrationsDir, { recursive: true });
    }

    if (postgresAvailable) {
      const { createPool } = require("../../src/database/postgres.js");
      const adminDb = createPool({});
      await adminDb.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await adminDb.close();
    }
  });

  beforeEach(async () => {
    if (!postgresAvailable) return;

    const { createPool } = require("../../src/database/postgres.js");
    db = createPool({ schema: testSchema, maxConnections: 1, connectionTimeoutMillis: 15000 });
    await db.query("DROP TABLE IF EXISTS test_items CASCADE");
    await db.query("DROP TABLE IF EXISTS schema_migrations CASCADE");
  });

  afterEach(async () => {
    if (db) {
      await db.query("DROP TABLE IF EXISTS test_items CASCADE").catch(() => {});
      await db.query("DROP TABLE IF EXISTS schema_migrations CASCADE").catch(() => {});
      await db.close();
      db = null;
    }
  });

  test("runs pending migrations and records them in schema_migrations", async (t) => {
    if (!postgresAvailable) {
      t.skip("PostgreSQL not available");
      return;
    }

    const { runMigrations } = require("../../src/database/postgres.js");
    await runMigrations(db, testMigrationsDir);

    const applied = await db.query("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepStrictEqual(
      applied.rows.map((row) => row.id),
      ["001_create_test_table.sql", "002_add_description.sql"],
    );

    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'test_items'",
      [testSchema],
    );
    assert.ok(columns.rows.some((row) => row.column_name === "description"));
  });

  test("skips migrations already recorded in schema_migrations", async (t) => {
    if (!postgresAvailable) {
      t.skip("PostgreSQL not available");
      return;
    }

    const { runMigrations } = require("../../src/database/postgres.js");
    await runMigrations(db, testMigrationsDir);
    await runMigrations(db, testMigrationsDir);

    const applied = await db.query("SELECT id FROM schema_migrations ORDER BY id");
    assert.equal(applied.rows.length, 2);
  });

  test("does not record a migration that fails inside its transaction", async (t) => {
    if (!postgresAvailable) {
      t.skip("PostgreSQL not available");
      return;
    }

    const badMigrationPath = path.join(testMigrationsDir, "003_bad_migration.sql");
    fs.writeFileSync(badMigrationPath, "CREATE TABLE this is invalid sql;\n");

    const { runMigrations } = require("../../src/database/postgres.js");

    await assert.rejects(
      async () => runMigrations(db, testMigrationsDir),
      /syntax error/i,
    );

    const applied = await db.query("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepStrictEqual(
      applied.rows.map((row) => row.id),
      ["001_create_test_table.sql", "002_add_description.sql"],
    );

    fs.unlinkSync(badMigrationPath);
  });
});
