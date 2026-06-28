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

describe("admin blend analysis routes", () => {
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
      "blend-admin@example.com",
      "admin123",
      "Blend Admin",
      "admin",
    );
    assert.equal(created.success, true);
    adminHeaders = await loginAdmin(app, "blend-admin@example.com");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("requires admin auth and trackVersionId for blend analysis", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/admin/dashboard/analyze-blend",
      payload: { trackVersionId: "missing" },
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const invalid = await app.inject({
      method: "POST",
      url: "/admin/dashboard/analyze-blend",
      headers: adminHeaders,
      payload: {},
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_REQUEST");
  });

  test("maps missing track versions to NOT_FOUND", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/analyze-blend",
      headers: adminHeaders,
      payload: { trackVersionId: "missing_version" },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "NOT_FOUND");
  });

  test("paths analysis is superadmin-only and storage-scoped", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/dashboard/analyze-blend/paths",
      headers: adminHeaders,
      payload: { originalVocalPath: "/tmp/test-storage/missing.wav" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const invalidPath = await app.inject({
      method: "POST",
      url: "/admin/dashboard/analyze-blend/paths",
      headers: superadminHeaders,
      payload: { originalVocalPath: "/tmp/outside-storage.wav" },
    });
    assert.equal(invalidPath.statusCode, 400, invalidPath.body);
    assert.equal(invalidPath.json().error, "INVALID_PATH");

    const noFiles = await app.inject({
      method: "POST",
      url: "/admin/dashboard/analyze-blend/paths",
      headers: superadminHeaders,
      payload: { originalVocalPath: "/tmp/test-storage/missing.wav" },
    });
    assert.equal(noFiles.statusCode, 400, noFiles.body);
    assert.equal(noFiles.json().error, "NO_FILES");
  });
});
