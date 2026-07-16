"use strict";

// Env must exist BEFORE requiring src/server (auth.js asserts JWT_SECRET at
// require time); ambient-shell env is not guaranteed in CI.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-web-funnel-32-bytes!!";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const authService = require("../../src/services/auth-service");
const { setFeatureFlag, clearCache } = require("../../src/services/feature-flags");
const {
  TurnstileUnavailableError,
  createTurnstileVerifier,
  resolveTurnstileSecret,
  TURNSTILE_TEST_SECRET,
} = require("../../src/services/turnstile");

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

describe("POST /web/session", () => {
  let db;
  let app;
  let verifier;

  beforeEach(async () => {
    process.env.JWT_SECRET = "test-jwt-secret-web-session-route-32-bytes";
    clearCache();
    db = await initDb();
    await setFeatureFlag(db, "web_funnel_enabled", true, "test");
    process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
    verifier = { verify: async () => ({ success: true }) };
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: { turnstileVerifier: verifier },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    clearCache();
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
  });

  it("creates a zero-entitlement guest with session-bound access and refresh tokens", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.10" },
      payload: { turnstile_token: "valid", entry_url: "https://porizo.co/create" },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    const access = authService.verifyAccessToken(body.access_token);
    assert.equal(access.sub, body.user_id);
    assert.ok(access.sid);
    assert.ok(body.refresh_token);
    assert.match(response.headers["set-cookie"], /__Host-porizo_guest=/);
    // P1-1 regression guard: the token-minting cookie must never ride a
    // cross-site top-level POST.
    assert.match(response.headers["set-cookie"], /SameSite=Strict/);

    const user = await db.query(
      "SELECT account_status FROM users WHERE id = ?",
      [body.user_id],
    );
    assert.equal(user.rows[0].account_status, "guest");
    const entitlement = await db.query(
      "SELECT songs_remaining, poems_remaining FROM entitlements WHERE user_id = ?",
      [body.user_id],
    );
    assert.deepEqual(entitlement.rows[0], { songs_remaining: 0, poems_remaining: 0 });
  });

  it("enforces the active-or-guest account status contract", async () => {
    await assert.rejects(
      db.query(
        "INSERT INTO users (id, created_at, account_status) VALUES (?, CURRENT_TIMESTAMP, ?)",
        ["user_invalid_account_status", "invalid"],
      ),
    );
  });

  it("reuses the guest identity from the opaque continuity cookie", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.11" },
      payload: { turnstile_token: "valid" },
    });
    assert.equal(first.statusCode, 200, first.body);
    const cookie = first.headers["set-cookie"].split(";")[0];

    const second = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.11", cookie },
      payload: { turnstile_token: "valid" },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().user_id, first.json().user_id);
    assert.notEqual(
      authService.verifyAccessToken(second.json().access_token).sid,
      authService.verifyAccessToken(first.json().access_token).sid,
    );
    const count = await db.query("SELECT COUNT(*) AS count FROM users WHERE account_status = 'guest'");
    assert.equal(Number(count.rows[0].count), 1);
  });

  it("rebinds an expired continuity cookie to the replacement guest", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.16" },
      payload: { turnstile_token: "valid" },
    });
    assert.equal(first.statusCode, 200, first.body);
    const cookie = first.headers["set-cookie"].split(";")[0];
    await db.query(
      "UPDATE web_guest_devices SET expires_at = ? WHERE user_id = ?",
      [new Date(Date.now() - 1000).toISOString(), first.json().user_id],
    );

    const replacement = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.16", cookie },
      payload: { turnstile_token: "valid" },
    });
    assert.equal(replacement.statusCode, 200, replacement.body);
    assert.notEqual(replacement.json().user_id, first.json().user_id);
    const mapping = await db.query(
      "SELECT user_id FROM web_guest_devices WHERE device_token_hash IS NOT NULL",
    );
    assert.equal(mapping.rows[0].user_id, replacement.json().user_id);
  });

  it("distinguishes invalid verification, provider outage, disabled flag, and IP cap", async () => {
    verifier.verify = async () => ({ success: false });
    const invalid = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.12" },
      payload: { turnstile_token: "bad" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "TURNSTILE_INVALID");

    verifier.verify = async () => {
      throw new TurnstileUnavailableError("offline");
    };
    const unavailable = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.13" },
      payload: { turnstile_token: "valid" },
    });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.json().error, "TURNSTILE_UNAVAILABLE");

    await setFeatureFlag(db, "web_funnel_enabled", false, "test");
    const disabled = await app.inject({
      method: "POST",
      url: "/web/session",
      headers: { "cf-connecting-ip": "203.0.113.14" },
      payload: { turnstile_token: "valid" },
    });
    assert.equal(disabled.statusCode, 404);

    await setFeatureFlag(db, "web_funnel_enabled", true, "test");
    verifier.verify = async () => ({ success: true });
    let capped;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      capped = await app.inject({
        method: "POST",
        url: "/web/session",
        headers: { "cf-connecting-ip": "203.0.113.15" },
        payload: { turnstile_token: "valid" },
      });
    }
    assert.equal(capped.statusCode, 429);
    assert.equal(capped.json().error, "WEB_SESSION_LIMIT_REACHED");
  });

  it("does not let direct-origin clients rotate CF headers around the session cap", async () => {
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await app.inject({
        method: "POST",
        url: "/web/session",
        headers: { "cf-connecting-ip": `203.0.113.${50 + attempt}` },
        payload: { turnstile_token: "valid" },
      });
    }
    assert.equal(response.statusCode, 429, response.body);
    assert.equal(response.json().error, "WEB_SESSION_LIMIT_REACHED");
  });
});

describe("Turnstile environment contract", () => {
  it("uses Cloudflare's official test secret only outside production", async () => {
    assert.equal(resolveTurnstileSecret({ environment: "development" }), TURNSTILE_TEST_SECRET);
    // Missing key must NOT be boot-fatal (deploy-before-setup is supported):
    // it resolves null and enforcement happens at verify() time instead.
    assert.equal(resolveTurnstileSecret({ environment: "production" }), null);
    const unconfigured = createTurnstileVerifier({ environment: "production" });
    await assert.rejects(
      unconfigured.verify({ token: "any" }),
      /TURNSTILE_SECRET_KEY is required/,
    );
    assert.throws(
      () =>
        resolveTurnstileSecret({
          environment: "production",
          secretKey: TURNSTILE_TEST_SECRET,
        }),
      /test secrets are forbidden/,
    );
  });

  it("rejects production tokens whose action or hostname does not match", async () => {
    const verifier = createTurnstileVerifier({
      environment: "production",
      secretKey: "production-secret",
      expectedAction: "web_session",
      expectedHostname: "porizo.co",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          success: true,
          action: "other_action",
          hostname: "evil.example",
        }),
      }),
    });
    assert.deepEqual(await verifier.verify({ token: "valid" }), {
      success: false,
      errorCodes: ["site-metadata-mismatch"],
    });
  });
});
