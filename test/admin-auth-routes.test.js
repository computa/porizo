require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

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

async function loginAdmin(app, password = "admin123") {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token;
}

describe("admin auth routes", () => {
  let db;
  let app;
  let originalSetupSecret;

  beforeEach(async () => {
    originalSetupSecret = process.env.ADMIN_SETUP_SECRET;
    delete process.env.ADMIN_SETUP_SECRET;
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
  });

  afterEach(async () => {
    if (originalSetupSecret === undefined) {
      delete process.env.ADMIN_SETUP_SECRET;
    } else {
      process.env.ADMIN_SETUP_SECRET = originalSetupSecret;
    }
    await app.close();
    await db.close?.();
  });

  test("setup endpoint is disabled without ADMIN_SETUP_SECRET", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/setup",
      payload: {
        secret: "wrong",
        email: "new-admin@example.com",
        password: "admin123",
      },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "NOT_FOUND");
  });

  test("me and logout preserve session behavior", async () => {
    const token = await loginAdmin(app);
    const headers = { Authorization: `Bearer ${token}` };

    const me = await app.inject({
      method: "GET",
      url: "/admin/auth/me",
      headers,
    });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().email, "admin@porizo.app");

    const logout = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers,
    });
    assert.equal(logout.statusCode, 200, logout.body);
    assert.deepEqual(logout.json(), { success: true });

    const afterLogout = await app.inject({
      method: "GET",
      url: "/admin/auth/me",
      headers,
    });
    assert.equal(afterLogout.statusCode, 401, afterLogout.body);
  });

  test("change-password validates fields and invalidates current session", async () => {
    const token = await loginAdmin(app);
    const headers = { Authorization: `Bearer ${token}` };

    const missing = await app.inject({
      method: "POST",
      url: "/admin/auth/change-password",
      headers,
      payload: { currentPassword: "admin123" },
    });
    assert.equal(missing.statusCode, 400, missing.body);
    assert.equal(missing.json().error, "MISSING_FIELDS");

    const weak = await app.inject({
      method: "POST",
      url: "/admin/auth/change-password",
      headers,
      payload: { currentPassword: "admin123", newPassword: "short" },
    });
    assert.equal(weak.statusCode, 400, weak.body);
    assert.equal(weak.json().error, "WEAK_PASSWORD");

    const invalidCurrent = await app.inject({
      method: "POST",
      url: "/admin/auth/change-password",
      headers,
      payload: {
        currentPassword: "wrong-password",
        newPassword: "new-admin-password-123",
      },
    });
    assert.equal(invalidCurrent.statusCode, 401, invalidCurrent.body);
    assert.equal(invalidCurrent.json().error, "INVALID_PASSWORD");

    const changed = await app.inject({
      method: "POST",
      url: "/admin/auth/change-password",
      headers,
      payload: {
        currentPassword: "admin123",
        newPassword: "new-admin-password-123",
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().success, true);

    const oldSession = await app.inject({
      method: "GET",
      url: "/admin/auth/me",
      headers,
    });
    assert.equal(oldSession.statusCode, 401, oldSession.body);

    await loginAdmin(app, "new-admin-password-123");
  });

  test("forgot and reset password preserve generic public envelopes", async () => {
    const forgot = await app.inject({
      method: "POST",
      url: "/admin/auth/forgot-password",
      payload: { email: "not-an-email" },
    });
    assert.equal(forgot.statusCode, 200, forgot.body);
    assert.equal(
      forgot.json().message,
      "If an account exists for that email, a reset link has been sent.",
    );

    const reset = await app.inject({
      method: "POST",
      url: "/admin/auth/reset-password",
      payload: {
        token: "missing-token",
        new_password: "new-admin-password-123",
      },
    });
    assert.equal(reset.statusCode, 400, reset.body);
    assert.equal(reset.json().error, "INVALID_TOKEN");
  });
});
