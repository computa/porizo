#!/usr/bin/env node
/**
 * Run the test suite (or a subset) against a real PostgreSQL database.
 *
 * The default `npm test` runs every test against in-memory SQLite. That proves
 * the code is internally consistent but NOT that it works against the production
 * PostgreSQL dialect (JSON ops, RETURNING, ON CONFLICT, type coercion,
 * transaction isolation). This harness closes that gap: it provisions an
 * isolated database, applies the canonical `migrations/pg/` set via the app's
 * own runner, and runs tests with `DB_PROVIDER=postgres` so every
 * `getDatabase()` call hits real Postgres.
 *
 * Key contract (learned the hard way — see tasks/lessons.md 2026-06-30):
 *   - Keep NODE_ENV=test and the standard test flags. DB_PROVIDER=postgres wins
 *     over the `NODE_ENV==='test' -> sqlite` default in getDatabase().
 *   - Do NOT load `.env`. It carries production auth values that break tests
 *     which inject a mock db into buildServer({db}) and rely on the clean test
 *     environment (e.g. billing-restore-path returns 401 instead of 200).
 *
 * Usage:
 *   node tools/run-tests-postgres.js [test-glob-or-files...]
 *   npm run test:pg                          # repository + integration surface
 *   npm run test:pg -- test/gift-wallet-repository.test.js
 *
 * Env overrides:
 *   PG_TEST_HOST     (default localhost)
 *   PG_TEST_PORT     (default 5432)
 *   PG_TEST_DB       (default porizo_verify)
 *   PG_TEST_USER     (default porizo)
 *   PG_TEST_PASSWORD (default porizo)
 *   PG_TEST_KEEP=1   keep the database after the run (default: dropped)
 */

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

const HOST = process.env.PG_TEST_HOST || "localhost";
const PORT = process.env.PG_TEST_PORT || "5432";
const DB = process.env.PG_TEST_DB || "porizo_verify";
const USER = process.env.PG_TEST_USER || "porizo";
const PASSWORD = process.env.PG_TEST_PASSWORD || "porizo";
const KEEP = process.env.PG_TEST_KEEP === "1";

// Default target: the surface where PG-vs-SQLite divergence actually lives —
// the extracted repositories plus the cross-repo integration tests.
const DEFAULT_TARGETS = [
  "test/**/*repository*.test.js",
  "test/services/**/*.test.js",
  "test/workflows/**/*.test.js",
  "test/routes/**/*.test.js",
  "test/jobs/**/*.test.js",
];

function psqlAdmin(sql) {
  // Connect as the current OS superuser to the maintenance DB for create/drop.
  execFileSync(
    "psql",
    ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    {
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
}

async function provision() {
  console.log(`[test:pg] (re)creating isolated database "${DB}"`);
  psqlAdmin(`DROP DATABASE IF EXISTS ${DB};`);
  // Ensure the role exists (idempotent).
  try {
    psqlAdmin(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${USER}') THEN CREATE ROLE ${USER} LOGIN PASSWORD '${PASSWORD}'; END IF; END $$;`,
    );
  } catch {
    /* role may already exist with different ownership; ignore */
  }
  psqlAdmin(`CREATE DATABASE ${DB} OWNER ${USER};`);

  // Apply PG migrations via the app's own runner (the real path).
  process.env.DB_PROVIDER = "postgres";
  const { createPool, runMigrations } = require(
    path.resolve("src/database/postgres.js"),
  );
  const db = createPool({
    host: HOST,
    port: Number(PORT),
    database: DB,
    user: USER,
    password: PASSWORD,
  });
  const dir = path.resolve("migrations/pg");
  await runMigrations(db, dir);
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
  );
  console.log(`[test:pg] migrations applied; ${rows[0].n} tables`);
  await (db.close?.() ?? db.pool?.end?.());
}

function runTests(targets) {
  const args = ["--test", "--test-concurrency=1", ...targets];
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DB_PROVIDER: "postgres",
    POSTGRES_HOST: HOST,
    POSTGRES_PORT: PORT,
    POSTGRES_DB: DB,
    POSTGRES_USER: USER,
    POSTGRES_PASSWORD: PASSWORD,
    ALLOW_ANON_USER_ID: "true",
    ALLOW_DEVICE_TOKEN_FALLBACK: "true",
  };
  // Explicitly drop any DATABASE_URL so it can't shadow the POSTGRES_* config.
  delete env.DATABASE_URL;
  console.log(
    `[test:pg] running ${targets.length} target(s) against postgres://${USER}@${HOST}:${PORT}/${DB}`,
  );
  const res = spawnSync("node", args, { stdio: "inherit", env });
  return res.status ?? 1;
}

function cleanup() {
  if (KEEP) {
    console.log(`[test:pg] PG_TEST_KEEP=1 — leaving database "${DB}" in place`);
    return;
  }
  try {
    psqlAdmin(`DROP DATABASE IF EXISTS ${DB};`);
    console.log(`[test:pg] dropped database "${DB}"`);
  } catch (e) {
    console.warn(`[test:pg] could not drop "${DB}": ${e.message}`);
  }
}

(async () => {
  const targets = process.argv.slice(2);
  const finalTargets = targets.length > 0 ? targets : DEFAULT_TARGETS;
  let code = 1;
  try {
    await provision();
    code = runTests(finalTargets);
  } catch (e) {
    console.error("[test:pg] harness error:", e.message);
    code = 1;
  } finally {
    cleanup();
  }
  process.exit(code);
})();
