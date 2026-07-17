"use strict";

// Env must exist BEFORE requiring src/server (auth.js asserts JWT_SECRET at
// require time); ambient-shell env is not guaranteed in CI.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-web-funnel-32-bytes!!";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const authService = require("../../src/services/auth-service");
const emailService = require("../../src/services/email-service");

const ORIGIN = "https://porizo.co";

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

describe("POST /auth/web/token", () => {
  let db;
  let app;
  let previousOrigin;
  let previousAllowedOrigins;

  beforeEach(async () => {
    previousOrigin = process.env.MAGIC_LOGIN_WEB_ORIGIN;
    previousAllowedOrigins = process.env.MAGIC_LOGIN_WEB_ALLOWED_ORIGINS;
    process.env.MAGIC_LOGIN_WEB_ORIGIN = ORIGIN;
    process.env.MAGIC_LOGIN_WEB_ALLOWED_ORIGINS = ORIGIN;
    process.env.JWT_SECRET = "test-jwt-secret-auth-web-token-32-bytes";
    db = await initDb();
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: {
        turnstileVerifier: { verify: async () => ({ success: true }) },
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    if (previousOrigin === undefined) delete process.env.MAGIC_LOGIN_WEB_ORIGIN;
    else process.env.MAGIC_LOGIN_WEB_ORIGIN = previousOrigin;
    if (previousAllowedOrigins === undefined) {
      delete process.env.MAGIC_LOGIN_WEB_ALLOWED_ORIGINS;
    } else {
      process.env.MAGIC_LOGIN_WEB_ALLOWED_ORIGINS = previousAllowedOrigins;
    }
  });

  async function seedWebSession() {
    const userId = `user_web_${crypto.randomBytes(6).toString("hex")}`;
    const sessionId = `sess_web_${crypto.randomBytes(6).toString("hex")}`;
    const rawSession = crypto.randomBytes(24).toString("base64url");
    const now = new Date();
    await db.query(
      "INSERT INTO users (id, created_at, account_status) VALUES (?, ?, 'active')",
      [userId, now.toISOString()],
    );
    await db.query(
      `INSERT INTO user_sessions (
         id, user_id, last_active_at, auth_method, platform, authenticated_at,
         idle_expires_at, absolute_expires_at, last_rotated_at, web_session_hash
       ) VALUES (?, ?, ?, 'magic_email', 'web', ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        now.toISOString(),
        now.toISOString(),
        new Date(now.getTime() + 86400000).toISOString(),
        new Date(now.getTime() + 2 * 86400000).toISOString(),
        now.toISOString(),
        crypto.createHash("sha256").update(rawSession).digest("hex"),
      ],
    );
    return { userId, sessionId, rawSession };
  }

  it("mints a standard session-bound access token with valid Origin and CSRF", async () => {
    const seeded = await seedWebSession();
    const csrf = crypto.randomBytes(18).toString("base64url");
    const response = await app.inject({
      method: "POST",
      url: "/auth/web/token",
      headers: {
        origin: ORIGIN,
        "x-csrf-token": csrf,
        cookie: `__Host-porizo_session=${seeded.rawSession}; __Host-porizo_web_csrf=${csrf}`,
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = authService.verifyAccessToken(response.json().access_token);
    assert.equal(payload.sub, seeded.userId);
    assert.equal(payload.sid, seeded.sessionId);
    assert.equal(response.json().expires_in, 900);
    assert.equal(response.headers["cache-control"], "no-store");
  });

  it("completes request, same-host email exchange, and token bridge on porizo.co", async () => {
    const userId = `user_bridge_${crypto.randomBytes(5).toString("hex")}`;
    const email = `${userId}@example.com`;
    await db.query(
      "INSERT INTO users (id, email, email_verified, created_at, account_status) VALUES (?, ?, 1, CURRENT_TIMESTAMP, 'active')",
      [userId, email],
    );
    await db.query(
      `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, CURRENT_TIMESTAMP, 'user_entered', 1, 0)`,
      [`contact_${userId}`, userId, email, email],
    );

    const originalIsConfigured = emailService.isConfigured;
    const originalSend = emailService.sendMagicLoginEmail;
    let delivered;
    emailService.isConfigured = () => true;
    emailService.sendMagicLoginEmail = async (_email, options) => {
      delivered = options;
    };
    try {
      const requested = await app.inject({
        method: "POST",
        url: "/auth/magic/request",
        headers: { origin: ORIGIN },
        payload: { email, platform: "web", purpose: "login" },
      });
      assert.equal(requested.statusCode, 202, requested.body);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(delivered.webOrigin, ORIGIN);
      const requestCookies = String(requested.headers["set-cookie"]);
      const preauth = requestCookies.match(/__Host-porizo_preauth=([^;,]+)/)?.[1];
      const csrf = requestCookies.match(/__Host-porizo_csrf=([^;,]+)/)?.[1];
      assert.ok(preauth);
      assert.ok(csrf);

      const exchanged = await app.inject({
        method: "POST",
        url: "/auth/magic/exchange",
        headers: {
          origin: ORIGIN,
          cookie: `__Host-porizo_preauth=${preauth}; __Host-porizo_csrf=${csrf}`,
        },
        payload: {
          transaction_id: requested.json().transaction_id,
          platform: "web",
          link_secret: delivered.linkSecret,
          csrf: decodeURIComponent(csrf),
        },
      });
      assert.equal(exchanged.statusCode, 200, exchanged.body);
      const exchangeCookies = String(exchanged.headers["set-cookie"]);
      assert.match(exchangeCookies, /__Host-porizo_session=[^,]*SameSite=Strict/);
      assert.match(exchangeCookies, /__Host-porizo_web_csrf=[^,]*SameSite=Strict/);
      assert.match(exchangeCookies, /__Host-porizo_preauth=[^,]*SameSite=Lax/);
      const session = exchangeCookies.match(/__Host-porizo_session=([^;,]+)/)?.[1];
      const webCsrf = exchangeCookies.match(/__Host-porizo_web_csrf=([^;,]+)/)?.[1];
      assert.ok(session);
      assert.ok(webCsrf);

      const bridged = await app.inject({
        method: "POST",
        url: "/auth/web/token",
        headers: {
          origin: ORIGIN,
          "x-csrf-token": decodeURIComponent(webCsrf),
          cookie: `__Host-porizo_session=${session}; __Host-porizo_web_csrf=${webCsrf}`,
        },
      });
      assert.equal(bridged.statusCode, 200, bridged.body);
      assert.equal(
        authService.verifyAccessToken(bridged.json().access_token).sub,
        userId,
      );
    } finally {
      emailService.isConfigured = originalIsConfigured;
      emailService.sendMagicLoginEmail = originalSend;
    }
  });

  it("rejects wrong origins, missing CSRF, and revoked sessions", async () => {
    const seeded = await seedWebSession();
    const csrf = "csrf-token";
    const cookie = `__Host-porizo_session=${seeded.rawSession}; __Host-porizo_web_csrf=${csrf}`;

    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/auth/web/token",
      headers: { origin: "https://evil.example", "x-csrf-token": csrf, cookie },
    });
    assert.equal(wrongOrigin.statusCode, 403);
    assert.equal(wrongOrigin.json().error, "INVALID_ORIGIN");

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/auth/web/token",
      headers: { origin: ORIGIN, cookie },
    });
    assert.equal(missingCsrf.statusCode, 403);
    assert.equal(missingCsrf.json().error, "INVALID_CSRF");

    await db.query("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?", [
      seeded.sessionId,
    ]);
    const revoked = await app.inject({
      method: "POST",
      url: "/auth/web/token",
      headers: { origin: ORIGIN, "x-csrf-token": csrf, cookie },
    });
    assert.equal(revoked.statusCode, 401);
    assert.equal(revoked.json().error, "INVALID_SESSION");
  });
});
