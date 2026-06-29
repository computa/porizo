require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const NOW = new Date();
const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

function isoAgo(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
    },
    storage: {
      put: async () => {},
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      getSignedUrl: async (key) => `http://localhost/${key}`,
    },
  });
}

async function loginAdmin(app) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedUser(db, { id, createdAt, tier = null }) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, createdAt);

  if (tier) {
      await db
        .prepare(
          `INSERT INTO entitlements (
          user_id, tier, updated_at
        ) VALUES (?, ?, ?)`,
        )
        .run(id, tier, createdAt);
  }
}

async function seedTrackVersion(db, { id, renderType, createdAt }) {
  const trackId = `${id}_track`;
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'overview_user_today', 'complete', 'Overview Song', 1, ?, ?)`,
    )
    .run(trackId, createdAt, createdAt);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', ?, ?, ?)`,
    )
    .run(id, trackId, renderType, `${id}_hash`, createdAt);
}

async function seedJob(db, { id, status, createdAt }) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, track_version_id, workflow_type, status, created_at, updated_at
      ) VALUES (?, 'overview_version_preview_today', 'song_render', ?, ?, ?)`,
    )
    .run(id, status, createdAt, createdAt);
}

function countMap(rows, key = "status") {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

describe("admin overview metrics routes", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    adminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("overview metrics require an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/overview",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("overview metrics preserve user, entitlement, job, and preview-render aggregates", async () => {
    await seedUser(db, {
      id: "overview_user_today",
      createdAt: isoAgo(2 * HOURS),
      tier: "pro",
    });
    await seedUser(db, {
      id: "overview_user_week",
      createdAt: isoAgo(2 * DAYS),
      tier: "trial",
    });
    await seedUser(db, {
      id: "overview_user_old",
      createdAt: isoAgo(9 * DAYS),
      tier: "free",
    });
    await seedUser(db, {
      id: "overview_user_no_entitlement",
      createdAt: isoAgo(9 * DAYS),
    });

    await seedTrackVersion(db, {
      id: "overview_version_preview_today",
      renderType: "preview",
      createdAt: isoAgo(3 * HOURS),
    });
    await seedTrackVersion(db, {
      id: "overview_version_preview_recent",
      renderType: "preview",
      createdAt: isoAgo(6 * HOURS),
    });
    await seedTrackVersion(db, {
      id: "overview_version_full_today",
      renderType: "full",
      createdAt: isoAgo(4 * HOURS),
    });
    await seedTrackVersion(db, {
      id: "overview_version_preview_old",
      renderType: "preview",
      createdAt: isoAgo(2 * DAYS),
    });

    await seedJob(db, {
      id: "overview_job_queued",
      status: "queued",
      createdAt: isoAgo(3 * HOURS),
    });
    await seedJob(db, {
      id: "overview_job_running",
      status: "running",
      createdAt: isoAgo(2 * HOURS),
    });
    await seedJob(db, {
      id: "overview_job_failed_a",
      status: "failed",
      createdAt: isoAgo(1 * HOURS),
    });
    await seedJob(db, {
      id: "overview_job_failed_b",
      status: "failed",
      createdAt: isoAgo(30 * 60 * 1000),
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/overview",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.totalUsers, 4);
    assert.equal(body.newUsersToday, 1);
    assert.equal(body.newUsersWeek, 2);
    assert.equal(body.rendersToday, 2);
    assert.deepEqual(countMap(body.tierDist, "tier"), {
      free: 1,
      pro: 1,
      trial: 1,
    });
    assert.deepEqual(countMap(body.jobStats), {
      failed: 2,
      queued: 1,
      running: 1,
    });
  });
});
