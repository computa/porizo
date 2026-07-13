"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-magic-login-jwt-secret-32-characters";

const { before, after, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const {
  createMagicLoginRepository,
} = require("../src/database/magic-login-repository");
const {
  createMagicLoginService,
} = require("../src/services/magic-login-service");

describe("platform-bound magic login API", () => {
  let app;
  let db;
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-magic-api-"));
    db = await initDb({
      dbPath: path.join(tmpDir, "test.db"),
      migrationsDir: path.join(__dirname, "..", "migrations"),
    });
    app = buildServer({
      db,
      config: { CLEANUP_INTERVAL_MS: 0, UPLOAD_SIGNING_SECRET: "test-secret" },
      storage: createStorageProvider({ type: "local", basePath: tmpDir }),
    });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    db?.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET guidance is no-store and does not consume the transaction", async () => {
    const service = createMagicLoginService({
      repository: createMagicLoginRepository(db),
    });
    const created = await service.createTransaction({
      email: "scanner@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "scanner-requester-key",
    });
    const response = await app.inject({
      method: "GET",
      url: `/auth/magic/ios?transaction_id=${created.transactionId}`,
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["cache-control"], /no-store/);
    assert.equal(
      (await createMagicLoginRepository(db).findById(created.transactionId)).status,
      "pending",
    );
  });

  it("rejects cross-platform exchange without consuming the link", async () => {
    const service = createMagicLoginService({
      repository: createMagicLoginRepository(db),
    });
    const created = await service.createTransaction({
      email: "cross-platform@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "cross-platform-requester",
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "android",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(
      (await createMagicLoginRepository(db).findById(created.transactionId)).status,
      "pending",
    );
  });

  it("exchanges once for a verified email and returns 15-minute native credentials", async () => {
    const userId = "user_magic_api";
    const email = "magic-api@example.com";
    await db.prepare(
      "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)",
    ).run(userId, email);
    await db.prepare(
      `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, CURRENT_TIMESTAMP, 'user_entered', 1, 0)`,
    ).run("contact_magic_api", userId, email, email);
    const service = createMagicLoginService({
      repository: createMagicLoginRepository(db),
    });
    const created = await service.createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "native-requester-key",
    });
    const payload = {
      transaction_id: created.transactionId,
      platform: "ios",
      link_secret: created.linkSecret,
      request_secret: created.requestSecret,
    };
    const first = await app.inject({ method: "POST", url: "/auth/magic/exchange", payload });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().user_id, userId);
    assert.equal(first.json().expires_in, 900);
    assert.ok(first.json().access_token);
    assert.ok(first.json().refresh_token);

    const recovery = await app.inject({ method: "POST", url: "/auth/magic/exchange", payload });
    assert.equal(recovery.statusCode, 200, recovery.body);
    assert.equal(recovery.json().refresh_token, first.json().refresh_token);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = ?").get(userId);
    assert.equal(Number(count.count), 1);
  });

  it("links a magic-verified email as both contact and login credential without issuing replacement tokens", async () => {
    const userId = "user_magic_add_email";
    const email = "magic-add-email@example.com";
    await db.prepare(
      "INSERT INTO users (id, created_at) VALUES (?, CURRENT_TIMESTAMP)",
    ).run(userId);
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "add_email",
      requesterKey: "add-email-requester-key",
      accountId: userId,
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      user_id: userId,
      contact_verified: true,
    });
    const contact = await db.prepare(
      "SELECT verified_at FROM user_contacts WHERE user_id = ? AND type = 'email' AND value_normalized = ?",
    ).get(userId, email);
    assert.ok(contact?.verified_at);
    const identity = await db.prepare(
      "SELECT status FROM user_auth_providers WHERE user_id = ? AND provider = 'email' AND provider_user_id = ?",
    ).get(userId, email);
    assert.equal(identity?.status, "active");
  });

  it("creates an account only after an unknown email completes the two-secret exchange", async () => {
    const email = "new-magic-user@example.com";
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "new-user-requester-key",
    });
    assert.equal(
      await db.prepare("SELECT id FROM users WHERE email = ?").get(email),
      undefined,
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().is_new_user, true);
    assert.ok(response.json().access_token);
    const user = await db.prepare(
      "SELECT id, email, email_verified FROM users WHERE email = ?",
    ).get(email);
    assert.ok(user?.id);
    assert.equal(Boolean(user.email_verified), true);
    const entitlement = await db.prepare(
      "SELECT tier FROM entitlements WHERE user_id = ?",
    ).get(user.id);
    assert.equal(entitlement?.tier, "free");
  });

  it("returns a typed cooldown error for repeated requests", async () => {
    const payload = {
      email: "magic-cooldown-unique@example.com",
      platform: "ios",
      purpose: "login",
      requester_key: "cooldown-requester-key-1234",
    };
    const first = await app.inject({
      method: "POST",
      url: "/auth/magic/request",
      payload,
    });
    assert.equal(first.statusCode, 202, first.body);
    assert.ok(first.json().request_secret);

    const second = await app.inject({
      method: "POST",
      url: "/auth/magic/request",
      payload,
    });
    assert.equal(second.statusCode, 429, second.body);
    assert.equal(second.json().error, "MAGIC_LOGIN_COOLDOWN");
  });

  it("web exchange requires Origin, CSRF and pre-auth cookie and returns only an opaque cookie", async () => {
    const userId = "user_magic_web";
    const email = "magic-web@example.com";
    await db.prepare(
      "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)",
    ).run(userId, email);
    await db.prepare(
      `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, CURRENT_TIMESTAMP, 'user_entered', 1, 0)`,
    ).run("contact_magic_web", userId, email, email);
    const csrf = "web-csrf-requester-key-123456789";
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "web",
      purpose: "login",
      requesterKey: csrf,
    });
    const preauth = Buffer.from(
      JSON.stringify({
        transactionId: created.transactionId,
        requestSecret: created.requestSecret,
      }),
      "utf8",
    ).toString("base64url");
    const payload = {
      transaction_id: created.transactionId,
      platform: "web",
      link_secret: created.linkSecret,
      csrf,
    };
    const missingOrigin = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      headers: {
        cookie: `__Host-porizo_preauth=${preauth}; __Host-porizo_csrf=${csrf}`,
      },
      payload,
    });
    assert.equal(missingOrigin.statusCode, 400);

    const exchanged = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      headers: {
        origin: "https://auth.porizo.co",
        cookie: `__Host-porizo_preauth=${preauth}; __Host-porizo_csrf=${csrf}`,
      },
      payload,
    });
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    assert.equal(exchanged.json().access_token, undefined);
    assert.equal(exchanged.json().refresh_token, undefined);
    const setCookies = exchanged.headers["set-cookie"];
    assert.match(String(setCookies), /__Host-porizo_session=/);
    assert.match(String(setCookies), /HttpOnly/);
    assert.doesNotMatch(String(setCookies), /Domain=/i);
    const sessionToken = String(setCookies).match(/__Host-porizo_session=([^;,]+)/)[1];
    const session = await app.inject({
      method: "GET",
      url: "/auth/web/session",
      headers: { cookie: `__Host-porizo_session=${sessionToken}` },
    });
    assert.equal(session.statusCode, 200, session.body);
    assert.equal(session.json().user_id, userId);
  });
});
