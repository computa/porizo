require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

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

async function loginAdmin(app, email = "admin@porizo.app") {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email, password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

describe("admin provider and queue control routes", () => {
  let db;
  let app;
  let superadminHeaders;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    superadminHeaders = await loginAdmin(app);
    const created = await adminAuthService.createAdmin(
      "control-admin@example.com",
      "admin123",
      "Control Admin",
      "admin",
    );
    assert.equal(created.success, true);
    adminHeaders = await loginAdmin(app, "control-admin@example.com");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("lists providers and queues only for authenticated admins", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/admin/dashboard/providers",
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const providers = await app.inject({
      method: "GET",
      url: "/admin/dashboard/providers",
      headers: adminHeaders,
    });
    assert.equal(providers.statusCode, 200, providers.body);
    assert.ok(
      providers.json().providers.some(
        (provider) => provider.provider_name === "replicate",
      ),
    );

    const queues = await app.inject({
      method: "GET",
      url: "/admin/dashboard/queues",
      headers: adminHeaders,
    });
    assert.equal(queues.statusCode, 200, queues.body);
    assert.ok(
      queues.json().queues.some(
        (queue) => queue.queue_name === "q.render.music.api",
      ),
    );
  });

  test("updates provider status with superadmin role and validates payloads", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/dashboard/providers/replicate/status",
      headers: adminHeaders,
      payload: { status: "paused", reason: "incident" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/dashboard/providers/replicate/status",
      headers: superadminHeaders,
      payload: { status: "draining" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_STATUS");

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/providers/replicate/status",
      headers: superadminHeaders,
      payload: { status: "paused", reason: "provider outage" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });

    const row = await db
      .prepare(
        "SELECT status, paused_by, pause_reason FROM provider_status WHERE provider_name = ?",
      )
      .get("replicate");
    assert.equal(row.status, "paused");
    assert.equal(row.paused_by, "adm_initial");
    assert.equal(row.pause_reason, "provider outage");
  });

  test("updates queue status with superadmin role and validates payloads", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/dashboard/queues/q.render.music.api/status",
      headers: superadminHeaders,
      payload: { status: "disabled" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_STATUS");

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/queues/q.render.music.api/status",
      headers: superadminHeaders,
      payload: { status: "draining", reason: "backpressure" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { success: true });

    const row = await db
      .prepare(
        "SELECT status, paused_by, pause_reason FROM queue_status WHERE queue_name = ?",
      )
      .get("q.render.music.api");
    assert.equal(row.status, "draining");
    assert.equal(row.paused_by, null);
    assert.equal(row.pause_reason, null);
  });
});
