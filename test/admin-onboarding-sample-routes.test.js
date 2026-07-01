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

describe("admin onboarding sample routes", () => {
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
      "onboarding-admin@example.com",
      "admin123",
      "Onboarding Admin",
      "admin",
    );
    assert.equal(created.success, true);
    adminHeaders = await loginAdmin(app, "onboarding-admin@example.com");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("lists onboarding samples for authenticated admins", async () => {
    await db
      .prepare(
        `INSERT INTO onboarding_samples
          (id, label, audio_url, is_active, created_at, updated_at)
         VALUES ('route_sample_list', 'Route Sample', '/audio/route.mp3', 1, ?, ?)`,
      )
      .run("2026-06-27T10:00:00.000Z", "2026-06-27T10:00:00.000Z");

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/admin/dashboard/onboarding-samples",
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/onboarding-samples",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(
      response.json().samples.some((sample) => sample.id === "route_sample_list"),
    );
  });

  test("creates and updates samples only for superadmins", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/dashboard/onboarding-samples",
      headers: adminHeaders,
      payload: { label: "Blocked", audio_url: "/audio/blocked.mp3" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/dashboard/onboarding-samples",
      headers: superadminHeaders,
      payload: { label: "", audio_url: "invalid-url" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "VALIDATION_ERROR");

    const created = await app.inject({
      method: "POST",
      url: "/admin/dashboard/onboarding-samples",
      headers: superadminHeaders,
      payload: { label: "Drive Home", audio_url: "/audio/drive-home.mp3" },
    });
    assert.equal(created.statusCode, 200, created.body);
    const sample = created.json().sample;
    assert.equal(sample.label, "Drive Home");
    assert.equal(sample.is_active, 0);

    const updated = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/onboarding-samples/${sample.id}`,
      headers: superadminHeaders,
      payload: {
        label: "Updated Drive Home",
        audio_url: "https://cdn.example.com/drive-home.mp3",
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().sample.label, "Updated Drive Home");
  });

  test("activates and deletes samples with expected not-found mapping", async () => {
    await db
      .prepare(
        `INSERT INTO onboarding_samples
          (id, label, audio_url, is_active, created_at, updated_at)
         VALUES ('route_sample_activate', 'Activate', '/audio/activate.mp3', 0, ?, ?)`,
      )
      .run("2026-06-27T10:00:00.000Z", "2026-06-27T10:00:00.000Z");

    const missing = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/onboarding-samples/missing/activate",
      headers: superadminHeaders,
      payload: {},
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json().error, "SAMPLE_NOT_FOUND");

    const activated = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/onboarding-samples/route_sample_activate/activate",
      headers: superadminHeaders,
      payload: {},
    });
    assert.equal(activated.statusCode, 200, activated.body);
    assert.equal(activated.json().sample.is_active, 1);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/admin/dashboard/onboarding-samples/route_sample_activate",
      headers: superadminHeaders,
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.deepEqual(deleted.json(), { success: true });
  });
});
