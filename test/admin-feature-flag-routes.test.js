require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");
const { clearCache } = require("../src/services/feature-flags");

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

describe("admin feature flag routes", () => {
  let db;
  let app;
  let superadminHeaders;

  beforeEach(async () => {
    clearCache();
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    superadminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    clearCache();
    await app.close();
    await db.close?.();
  });

  test("GET /admin/dashboard/feature-flags requires admin session and returns grouped metadata", async () => {
    const unauthorized = await app.inject({
      method: "GET",
      url: "/admin/dashboard/feature-flags",
    });
    assert.equal(unauthorized.statusCode, 401, unauthorized.body);
    assert.equal(unauthorized.json().error, "UNAUTHORIZED");

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/feature-flags",
      headers: superadminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.ok(Array.isArray(body.flags.developer));
    assert.ok(
      body.flags.developer.some(
        (flag) =>
          flag.id === "show_design_screens" &&
          flag.value === false &&
          flag.defaultValue === false &&
          flag.type === "boolean",
      ),
    );
  });

  test("PUT /admin/dashboard/feature-flags remains superadmin-only and validates empty bodies", async () => {
    const created = await adminAuthService.createAdmin(
      "feature-flag-admin@example.com",
      "admin123",
      "Feature Flag Admin",
      "admin",
    );
    assert.equal(created.success, true);
    const adminHeaders = await loginAdmin(app, "feature-flag-admin@example.com");

    const forbidden = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/feature-flags",
      headers: adminHeaders,
      payload: { show_design_screens: true },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error, "FORBIDDEN");

    const empty = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/feature-flags",
      headers: superadminHeaders,
      payload: {},
    });
    assert.equal(empty.statusCode, 400, empty.body);
    assert.equal(empty.json().error, "INVALID_REQUEST");
  });

  test("PUT /admin/dashboard/feature-flags preserves service validation and persists valid updates", async () => {
    const unknown = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/feature-flags",
      headers: superadminHeaders,
      payload: { unknown_feature_flag: true },
    });
    assert.equal(unknown.statusCode, 200, unknown.body);
    assert.deepEqual(unknown.json(), {
      success: false,
      updated: [],
      errors: [
        {
          flagId: "unknown_feature_flag",
          error: "Unknown flag: unknown_feature_flag",
        },
      ],
    });

    const update = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/feature-flags",
      headers: superadminHeaders,
      payload: { show_design_screens: true },
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.deepEqual(update.json(), {
      success: true,
      updated: [
        {
          flagId: "show_design_screens",
          value: true,
          success: true,
        },
      ],
    });

    const stored = await db
      .prepare("SELECT value FROM feature_flags WHERE id = ?")
      .get("show_design_screens");
    assert.deepEqual(stored, { value: "true" });
  });
});
