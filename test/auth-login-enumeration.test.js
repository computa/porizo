require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const { clearRateLimits } = require("../src/routes/auth");
const authService = require("../src/services/auth-service");

function buildApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
      CLEANUP_INTERVAL_MS: 0,
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

describe("user login enumeration hardening", () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildApp(db);
    await app.ready();
    clearRateLimits();
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  function uniqueEmail() {
    return `lock-${crypto.randomBytes(6).toString("hex")}@example.com`;
  }

  async function signup(email, password) {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "cf-connecting-ip": "203.0.113.50" },
      payload: { email, password },
    });
    assert.ok([200, 201].includes(res.statusCode), res.body);
    return res.json();
  }

  test("a locked account returns 401 INVALID_CREDENTIALS, not 403 ACCOUNT_LOCKED", async () => {
    const email = uniqueEmail();
    const password = "Sup3r-Secret-Pass";
    const signupBody = await signup(email, password);
    const userId =
      signupBody.user_id || signupBody.user?.id || signupBody.user?.user_id;
    assert.ok(userId, "signup should return a user id");

    // Lock the account server-side (5 failed attempts == lockout threshold).
    for (let i = 0; i < 5; i++) {
      await authService.incrementFailedLoginCount(userId);
    }
    assert.equal(await authService.isAccountLocked(userId), true);

    clearRateLimits();

    // Even with the CORRECT password, a locked account must return the generic
    // 401 (not a distinguishable 403 ACCOUNT_LOCKED).
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "cf-connecting-ip": "203.0.113.51" },
      payload: { email, password },
    });

    assert.equal(res.statusCode, 401, res.body);
    assert.equal(res.json().error, "INVALID_CREDENTIALS");
  });
});
