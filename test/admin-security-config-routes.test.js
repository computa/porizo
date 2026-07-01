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

function validSecurityConfig(overrides = {}) {
  return {
    sessionDurationHours: 12,
    maxFailedLoginAttempts: 6,
    lockoutDurationMinutes: 20,
    rateLimitDefaults: {
      track_create: { limit: 10, windowSeconds: 3600 },
    },
    iosMinSupportedVersion: "1.0.0",
    iosRecommendedVersion: "1.2.0",
    iosUpdateMessage: "Please update Porizo.",
    iosAutoRecommendedVersion: true,
    iosLastAppStoreVersion: "1.2.0",
    iosLastAppStoreSyncAt: "2026-06-27T10:00:00.000Z",
    iosAppStoreSyncError: "",
    ...overrides,
  };
}

describe("admin security config routes", () => {
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
      "security-admin@example.com",
      "admin123",
      "Security Admin",
      "admin",
    );
    assert.equal(created.success, true);
    adminHeaders = await loginAdmin(app, "security-admin@example.com");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("reads security config for authenticated admins", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/config",
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/config",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(typeof response.json().sessionDurationHours, "number");
  });

  test("updates security config only for superadmins", async () => {
    const forbidden = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/security/config",
      headers: adminHeaders,
      payload: validSecurityConfig(),
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const invalid = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/security/config",
      headers: superadminHeaders,
      payload: validSecurityConfig({ sessionDurationHours: 0 }),
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_CONFIG");

    const updated = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/security/config",
      headers: superadminHeaders,
      payload: validSecurityConfig(),
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.deepEqual(updated.json(), { success: true });

    const readBack = await app.inject({
      method: "GET",
      url: "/admin/dashboard/security/config",
      headers: superadminHeaders,
    });
    assert.equal(readBack.statusCode, 200, readBack.body);
    assert.equal(readBack.json().iosRecommendedVersion, "1.2.0");
  });

  test("sync-ios-version is superadmin-only and maps provider failures", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/dashboard/security/config/sync-ios-version",
      headers: adminHeaders,
      payload: {},
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/security/config/sync-ios-version",
      headers: superadminHeaders,
      payload: {},
    });
    assert.equal(response.statusCode, 502, response.body);
    assert.equal(response.json().error, "APP_STORE_SYNC_FAILED");
  });
});
