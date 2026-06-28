require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString().split("T")[0];
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

async function seedUser(db, id, createdAt) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(id, createdAt);
}

async function seedEvent(db, id, eventName, userId, createdAt) {
  await db
    .prepare(
      `INSERT INTO events (
        id, event_name, user_id, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, ?, ?, 'test', ?, '{}', ?)`,
    )
    .run(id, eventName, userId, `${id}_resource`, createdAt);
}

describe("admin KPI routes", () => {
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

  test("KPI routes require an admin session", async () => {
    const kpis = await app.inject({
      method: "GET",
      url: "/admin/dashboard/kpis",
    });
    const trends = await app.inject({
      method: "GET",
      url: "/admin/dashboard/kpis/trends",
    });

    assert.equal(kpis.statusCode, 401, kpis.body);
    assert.equal(kpis.json().error, "UNAUTHORIZED");
    assert.equal(trends.statusCode, 401, trends.body);
    assert.equal(trends.json().error, "UNAUTHORIZED");
  });

  test("KPI route computes recent daily aggregates and returns bare aggregate rows", async () => {
    const yesterday = isoDateDaysAgo(1);
    await seedUser(db, "kpi_route_user", `${yesterday}T10:00:00.000Z`);
    await seedEvent(
      db,
      "kpi_route_render_ready",
      "render_ready",
      "kpi_route_user",
      `${yesterday}T11:00:00.000Z`,
    );

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/kpis?days=1",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.ok(Array.isArray(body.aggregates));
    assert.equal(body.aggregates[0].date, yesterday);
    assert.equal(body.aggregates[0].dau, 1);
    assert.equal(body.aggregates[0].renders_completed, 1);
  });
});
