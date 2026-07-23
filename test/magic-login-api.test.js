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
const {
  createGiftWalletRepository,
} = require("../src/database/gift-wallet-repository");
const {
  createEtsyRedemptionService,
} = require("../src/services/etsy-redemption-service");
const {
  createEtsyCodeClaimService,
} = require("../src/services/etsy-code-claim-service");
const { setFeatureFlag } = require("../src/services/feature-flags");

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
    assert.match(response.body, /Continue sign-in/);
    assert.equal(
      (await createMagicLoginRepository(db).findById(created.transactionId))
        .status,
      "pending",
    );
  });

  it("keeps an Etsy return intent in the requester cookie and redirects back to /etsy", async () => {
    const requested = await app.inject({
      method: "POST",
      url: "/auth/magic/request",
      headers: { origin: "https://porizo.co" },
      payload: {
        email: "etsy-return@example.com",
        platform: "web",
        purpose: "login",
        return_to: "etsy",
      },
    });
    assert.equal(requested.statusCode, 202, requested.body);
    const setCookies = Array.isArray(requested.headers["set-cookie"])
      ? requested.headers["set-cookie"]
      : [requested.headers["set-cookie"]];
    const cookieHeader = setCookies.map((value) => value.split(";")[0]).join("; ");
    const response = await app.inject({
      method: "GET",
      url: `/auth/magic/web?transaction_id=${requested.json().transaction_id}`,
      headers: { cookie: cookieHeader },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('location.replace("/etsy")'));
    assert.doesNotMatch(response.body, /etsy-return@example\.com/);
  });

  it("redeems a server-side Etsy code claim from a different browser into the verified account", async () => {
    await setFeatureFlag(db, "etsy_fulfilment_mode", "code", "test");
    const wallet = createGiftWalletRepository(db);
    const redemption = createEtsyRedemptionService({
      db,
      giftWalletRepository: wallet,
    });
    const claims = createEtsyCodeClaimService({ db });
    const [code] = await redemption.mintBatch({
      batchLabel: "magic-cross-browser",
      count: 1,
    });
    const email = "etsy-cross-browser@example.com";
    const magic = createMagicLoginService({
      repository: createMagicLoginRepository(db),
    });
    const created = await magic.createTransaction({
      email,
      platform: "web",
      purpose: "login",
      requesterKey: "etsy-cross-browser-requester",
    });
    await claims.createPending({
      code,
      email,
      magicTransactionId: created.transactionId,
      expiresAt: created.expiresAt,
    });

    const guidance = await app.inject({
      method: "GET",
      url: `/auth/magic/web?transaction_id=${created.transactionId}`,
    });
    assert.equal(guidance.statusCode, 200, guidance.body);
    assert.match(guidance.body, /Protect your paid song/);
    assert.doesNotMatch(guidance.body, new RegExp(code));

    const exchanged = await app.inject({
      method: "POST",
      url: "/auth/magic/etsy-code/exchange",
      headers: { origin: "https://porizo.co" },
      payload: {
        transaction_id: created.transactionId,
        link_secret: created.linkSecret,
      },
    });
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    assert.equal(exchanged.json().etsy_code_redeemed, true);
    assert.match(String(exchanged.headers["set-cookie"]), /porizo_session/);
    const owner = await db
      .prepare(
        "SELECT redeemed_by_user_id FROM etsy_redemption_codes WHERE code = ?",
      )
      .get(code);
    assert.ok(owner?.redeemed_by_user_id);
    assert.equal(await wallet.getBalance(owner.redeemed_by_user_id), 1);
    const contact = await db
      .prepare(
        `SELECT verified_at FROM user_contacts
          WHERE user_id = ? AND type = 'email' AND value_normalized = ?`,
      )
      .get(owner.redeemed_by_user_id, email);
    assert.ok(contact?.verified_at);

    const replay = await app.inject({
      method: "POST",
      url: "/auth/magic/etsy-code/exchange",
      headers: { origin: "https://porizo.co" },
      payload: {
        transaction_id: created.transactionId,
        link_secret: created.linkSecret,
      },
    });
    assert.equal(replay.statusCode, 400, replay.body);
    assert.equal(await wallet.getBalance(owner.redeemed_by_user_id), 1);
  });

  it("creates an opaque Etsy code claim request without returning or linking the code", async () => {
    await setFeatureFlag(db, "etsy_fulfilment_mode", "code", "test");
    const redemption = createEtsyRedemptionService({
      db,
      giftWalletRepository: createGiftWalletRepository(db),
    });
    const [code] = await redemption.mintBatch({
      batchLabel: "magic-request-opaque",
      count: 1,
    });
    const requested = await app.inject({
      method: "POST",
      url: "/auth/magic/request",
      headers: { origin: "https://porizo.co" },
      payload: {
        email: "etsy-opaque@example.com",
        platform: "web",
        purpose: "login",
        return_to: "etsy_code",
        etsy_code: code,
      },
    });
    assert.equal(requested.statusCode, 202, requested.body);
    assert.doesNotMatch(requested.body, new RegExp(code));
    assert.equal(requested.headers["set-cookie"], undefined);
    const claim = await db
      .prepare(
        "SELECT code FROM etsy_code_claims WHERE magic_transaction_id = ?",
      )
      .get(requested.json().transaction_id);
    assert.equal(claim.code, code);
  });

  it("does not offer a broken browser approval action while approval is disabled", async () => {
    const previous = process.env.MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED;
    process.env.MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED = "false";
    try {
      const response = await app.inject({
        method: "GET",
        url: "/auth/magic/ios?transaction_id=disabled-browser-approval",
      });
      assert.equal(response.statusCode, 200);
      assert.doesNotMatch(response.body, /id="approve"/);
      assert.match(
        response.body,
        /Browser confirmation is temporarily unavailable/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED;
      } else {
        process.env.MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED = previous;
      }
    }
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
      (await createMagicLoginRepository(db).findById(created.transactionId))
        .status,
      "pending",
    );
  });

  it("exchanges once for a verified email and returns 15-minute native credentials", async () => {
    const userId = "user_magic_api";
    const email = "magic-api@example.com";
    await db
      .prepare(
        "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)",
      )
      .run(userId, email);
    await db
      .prepare(
        `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, CURRENT_TIMESTAMP, 'user_entered', 1, 0)`,
      )
      .run("contact_magic_api", userId, email, email);
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
    const first = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload,
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().user_id, userId);
    assert.equal(first.json().expires_in, 900);
    assert.ok(first.json().access_token);
    assert.ok(first.json().refresh_token);

    const recovery = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload,
    });
    assert.equal(recovery.statusCode, 200, recovery.body);
    assert.equal(recovery.json().refresh_token, first.json().refresh_token);
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = ?")
      .get(userId);
    assert.equal(Number(count.count), 1);
  });

  it("links a magic-verified email as both contact and login credential without issuing replacement tokens", async () => {
    const userId = "user_magic_add_email";
    const sessionId = "session_magic_add_email";
    const email = "magic-add-email@example.com";
    await db
      .prepare(
        "INSERT INTO users (id, created_at) VALUES (?, CURRENT_TIMESTAMP)",
      )
      .run(userId);
    await db
      .prepare(
        `INSERT INTO user_sessions
         (id, user_id, created_at, last_active_at, auth_method, platform,
          authenticated_at, idle_expires_at, absolute_expires_at, last_rotated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'email_magic', 'ios',
          CURRENT_TIMESTAMP, datetime('now', '+90 days'), datetime('now', '+365 days'), CURRENT_TIMESTAMP)`,
      )
      .run(sessionId, userId);
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "add_email",
      requesterKey: "add-email-requester-key",
      accountId: userId,
      authorizingSessionId: sessionId,
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
    const contact = await db
      .prepare(
        "SELECT verified_at FROM user_contacts WHERE user_id = ? AND type = 'email' AND value_normalized = ?",
      )
      .get(userId, email);
    assert.ok(contact?.verified_at);
    const identity = await db
      .prepare(
        "SELECT status FROM user_auth_providers WHERE user_id = ? AND provider = 'email' AND provider_user_id = ?",
      )
      .get(userId, email);
    assert.equal(identity?.status, "active");
  });

  it("rejects add-email exchange after the authorizing session is revoked", async () => {
    const userId = "user_magic_add_email_revoked";
    const sessionId = "session_magic_add_email_revoked";
    const email = "magic-add-email-revoked@example.com";
    await db
      .prepare("INSERT INTO users (id, created_at) VALUES (?, CURRENT_TIMESTAMP)")
      .run(userId);
    await db
      .prepare(
        `INSERT INTO user_sessions
         (id, user_id, created_at, last_active_at, auth_method, platform,
          authenticated_at, idle_expires_at, absolute_expires_at, last_rotated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'email_magic', 'ios',
          CURRENT_TIMESTAMP, datetime('now', '+90 days'), datetime('now', '+365 days'), CURRENT_TIMESTAMP)`,
      )
      .run(sessionId, userId);
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "add_email",
      requesterKey: "add-email-revoked-requester-key",
      accountId: userId,
      authorizingSessionId: sessionId,
    });
    await db
      .prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(sessionId);

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

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, "INVALID_MAGIC_LOGIN");
    const contact = await db
      .prepare(
        "SELECT id FROM user_contacts WHERE user_id = ? AND type = 'email' AND value_normalized = ?",
      )
      .get(userId, email);
    assert.equal(contact, undefined);
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
    const user = await db
      .prepare("SELECT id, email, email_verified FROM users WHERE email = ?")
      .get(email);
    assert.ok(user?.id);
    assert.equal(Boolean(user.email_verified), true);
    const entitlement = await db
      .prepare("SELECT tier FROM entitlements WHERE user_id = ?")
      .get(user.id);
    assert.equal(entitlement?.tier, "free");
  });

  it("does not create a duplicate owner for an unverified legacy contact", async () => {
    const userId = "user_magic_legacy_contact";
    const email = "legacy-unverified@example.com";
    await db
      .prepare(
        "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)",
      )
      .run(userId, email);
    await db
      .prepare(
        `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, NULL, 'user_entered', 1, 0)`,
      )
      .run("contact_magic_legacy", userId, email, email);
    await db
      .prepare(
        `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id)
       VALUES (?, ?, 'apple', ?)`,
      )
      .run("provider_magic_legacy", userId, "apple-legacy-subject");
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "legacy-requester-key",
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

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "LEGACY_ACCOUNT_RECOVERY_REQUIRED");
    assert.equal(response.json().details.masked_email, "l***@example.com");
    assert.equal(response.json().details.auth_methods, "apple");
    const owners = await db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?")
      .get(email);
    assert.equal(Number(owners.count), 1);
    assert.equal(
      (await createMagicLoginRepository(db).findById(created.transactionId))
        .status,
      "pending",
    );
  });

  it("refuses to adopt an email-only account whose login email differs (planted second email)", async () => {
    // Attack: an email-shell account (its own email login) plants a VICTIM's
    // email as an unverified contact. The victim's magic link must NOT sign
    // them into that account — the shell's email subject differs.
    const attackerId = "user_magic_email_shell_attacker";
    const attackerEmail = "attacker-own@example.com";
    const victimEmail = "victim-planted@example.com";
    await db
      .prepare(
        "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)",
      )
      .run(attackerId, attackerEmail);
    await db
      .prepare(
        `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id)
       VALUES (?, ?, 'email', ?)`,
      )
      .run("provider_magic_shell_attacker", attackerId, attackerEmail);
    await db
      .prepare(
        `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, NULL, 'user_entered', 0, 0)`,
      )
      .run(
        "contact_magic_planted_victim",
        attackerId,
        victimEmail,
        victimEmail,
      );
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email: victimEmail,
      platform: "ios",
      purpose: "login",
      requesterKey: "planted-requester-key",
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

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "LEGACY_ACCOUNT_RECOVERY_REQUIRED");
    assert.equal(response.json().details.auth_methods, "email");
    // The planted contact must remain unverified — the victim's click must
    // not verify an attacker-held contact.
    const planted = await db
      .prepare("SELECT verified_at FROM user_contacts WHERE id = ?")
      .get("contact_magic_planted_victim");
    assert.equal(planted.verified_at, null);
  });

  it("adopts a true email-only legacy account signing in with its own email", async () => {
    // Legitimate legacy shape: the account's ONLY auth factor is the email
    // login for this exact email, but the contact row was never verified.
    // Mailbox control here IS account ownership — auto-adopt.
    const legacyId = "user_magic_true_email_shell";
    const email = "legacy-shell-own@example.com";
    await db
      .prepare(
        "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)",
      )
      .run(legacyId, email);
    await db
      .prepare(
        `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id)
       VALUES (?, ?, 'email', ?)`,
      )
      .run("provider_magic_true_shell", legacyId, email);
    await db
      .prepare(
        `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, NULL, 'user_entered', 1, 0)`,
      )
      .run("contact_magic_true_shell", legacyId, email, email);
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "true-shell-requester-key",
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
    assert.equal(response.json().user_id, legacyId);
    assert.equal(Boolean(response.json().is_new_user), false);
    const contact = await db
      .prepare("SELECT verified_at FROM user_contacts WHERE id = ?")
      .get("contact_magic_true_shell");
    assert.ok(contact.verified_at);
    const owners = await db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?")
      .get(email);
    assert.equal(Number(owners.count), 1);
  });

  it("adopts a legacy contact-only account with no auth providers at all", async () => {
    // Oldest legacy shape: a contact row exists but the account has zero
    // auth-provider rows. Nothing to hijack — mailbox proof adopts it.
    const legacyId = "user_magic_no_provider_shell";
    const email = "legacy-no-provider@example.com";
    await db
      .prepare(
        "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)",
      )
      .run(legacyId, email);
    await db
      .prepare(
        `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, NULL, 'user_entered', 1, 0)`,
      )
      .run("contact_magic_no_provider", legacyId, email, email);
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "no-provider-requester-key",
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
    assert.equal(response.json().user_id, legacyId);
    const contact = await db
      .prepare("SELECT verified_at FROM user_contacts WHERE id = ?")
      .get("contact_magic_no_provider");
    assert.ok(contact.verified_at);
  });

  it("completes browser-approved native login with the requester secret", async () => {
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email: "native-browser-complete@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "native-browser-requester",
    });

    const pending = await app.inject({
      method: "POST",
      url: "/auth/magic/native/status",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        request_secret: created.requestSecret,
      },
    });
    assert.equal(pending.statusCode, 200, pending.body);
    assert.equal(pending.json().status, "pending");

    const crossOriginApproval = await app.inject({
      method: "POST",
      url: "/auth/magic/native/approve",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
      },
    });
    assert.equal(crossOriginApproval.statusCode, 403);

    const approve = await app.inject({
      method: "POST",
      url: "/auth/magic/native/approve",
      headers: { origin: "https://auth.porizo.co" },
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
      },
    });
    assert.equal(approve.statusCode, 200, approve.body);

    const complete = await app.inject({
      method: "POST",
      url: "/auth/magic/native/complete",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        request_secret: created.requestSecret,
      },
    });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.ok(complete.json().access_token);
    assert.ok(complete.json().refresh_token);
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
    await db
      .prepare(
        "INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)",
      )
      .run(userId, email);
    await db
      .prepare(
        `INSERT INTO user_contacts
       (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, CURRENT_TIMESTAMP, 'user_entered', 1, 0)`,
      )
      .run("contact_magic_web", userId, email, email);
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
        origin: "https://porizo.co",
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
    const sessionToken = String(setCookies).match(
      /__Host-porizo_session=([^;,]+)/,
    )[1];
    const session = await app.inject({
      method: "GET",
      url: "/auth/web/session",
      headers: { cookie: `__Host-porizo_session=${sessionToken}` },
    });
    assert.equal(session.statusCode, 200, session.body);
    assert.equal(session.json().user_id, userId);
  });
});
