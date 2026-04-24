require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

describe("admin auth seeded default credentials", () => {
  let db;
  let app;
  let originalNodeEnv;
  let originalBypass;

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    originalBypass = process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION;

    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });

    app = buildServer({
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
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalBypass === undefined) {
      delete process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION;
    } else {
      process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION = originalBypass;
    }

    await app.close();
    await db.close?.();
  });

  test("blocks the seeded admin password in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION;

    const result = await adminAuthService.login(
      "admin@porizo.app",
      "admin123",
      "127.0.0.1",
      "test"
    );

    assert.equal(result.success, false);
    assert.match(
      result.error,
      /Default seeded admin credentials are disabled in production/i
    );
  });

  test("allows the seeded account after its password is rotated in production", async () => {
    await adminAuthService.changePassword("adm_initial", "rotated-password-123");

    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION;

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "rotated-password-123" },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().admin.email, "admin@porizo.app");
  });

  test("supports an emergency production bypass via env", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION = "true";

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "admin123" },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().admin.email, "admin@porizo.app");
  });
});
