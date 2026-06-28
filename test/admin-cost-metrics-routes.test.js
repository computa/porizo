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

async function seedCostTrack(db) {
  const createdAt = isoAgo(30 * DAYS);
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')",
    )
    .run("cost_route_user", createdAt);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'cost_route_user', 'complete', 'Cost Metrics Song', 1, ?, ?)`,
    )
    .run("cost_route_track", createdAt, createdAt);
}

async function seedCostVersion(db, {
  id,
  versionNum,
  renderType,
  status = "completed",
  createdAt,
  costEstimateJson = null,
  actualCostJson = null,
}) {
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash,
        created_at, cost_estimate_json, actual_cost_json
      ) VALUES (?, 'cost_route_track', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      versionNum,
      status,
      renderType,
      `${id}_hash`,
      createdAt,
      costEstimateJson,
      actualCostJson,
    );
}

function mapByRenderType(rows) {
  return Object.fromEntries(rows.map((row) => [row.render_type, row]));
}

describe("admin cost metrics routes", () => {
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

  test("cost metrics require an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/costs",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("cost metrics preserve daily window and all-time type aggregates", async () => {
    await seedCostTrack(db);
    const recentDate = isoAgo(2 * HOURS);
    const oldDate = isoAgo(9 * DAYS);

    await seedCostVersion(db, {
      id: "cost_route_preview_recent",
      versionNum: 1,
      renderType: "preview",
      status: "preview_ready",
      createdAt: recentDate,
      costEstimateJson: JSON.stringify({ usd: 1.5 }),
    });
    await seedCostVersion(db, {
      id: "cost_route_full_recent",
      versionNum: 2,
      renderType: "full",
      status: "full_ready",
      createdAt: recentDate,
      costEstimateJson: JSON.stringify({ usd: "2.25" }),
    });
    await seedCostVersion(db, {
      id: "cost_route_preview_old",
      versionNum: 3,
      renderType: "preview",
      status: "preview_ready",
      createdAt: oldDate,
      costEstimateJson: JSON.stringify({ usd: 0.75 }),
    });
    await seedCostVersion(db, {
      id: "cost_route_ready_excluded",
      versionNum: 4,
      renderType: "preview",
      status: "ready",
      createdAt: recentDate,
      actualCostJson: JSON.stringify({ total_usd: 9 }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/costs?days=7",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(body.dailyCosts, [
      {
        date: recentDate.slice(0, 10),
        renders: 2,
        total_cost_usd: 3.75,
      },
    ]);
    assert.deepEqual(mapByRenderType(body.costByType), {
      preview: {
        render_type: "preview",
        count: 2,
        avg_cost_usd: 1.125,
        total_cost_usd: 2.25,
      },
      full: {
        render_type: "full",
        count: 1,
        avg_cost_usd: 2.25,
        total_cost_usd: 2.25,
      },
    });
  });
});
