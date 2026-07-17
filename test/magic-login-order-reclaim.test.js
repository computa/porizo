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

const NOW = "2026-07-17T10:00:00.000Z";

// Seed a first-time buyer: a promoted-guest SHELL (account_status active but no
// auth factor) that owns a delivered order paid with `email`, plus its unverified
// email contact — exactly the state convergence branch (c)/"no_email" leaves.
async function seedGuestBuyerWithPaidOrder(db, { guestId, email, orderId }) {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', 'active')",
    )
    .run(guestId, NOW);
  await db
    .prepare(
      "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
    )
    .run(guestId, NOW);
  await db
    .prepare(
      `INSERT INTO user_contacts
         (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay)
       VALUES (?, ?, 'email', ?, ?, NULL, 'stripe_checkout', 1, 0)`,
    )
    .run(`ct_${guestId}`, guestId, email, email);
  await db
    .prepare(
      `INSERT INTO web_orders (
         id, checkout_session_id, user_id, track_id, track_version_id,
         price_key, amount_cents, currency, email, status,
         render_attempts, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'gift_bundle_1', 199, 'usd', ?, 'delivered', 0, ?, ?)`,
    )
    .run(
      orderId,
      `cs_${orderId}`,
      guestId,
      `trk_${orderId}`,
      `trk_${orderId}_v1`,
      email,
      NOW,
      NOW,
    );
}

describe("magic-link login reclaims a first-time buyer's paid order", () => {
  let app;
  let db;
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-reclaim-api-"));
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

  it("re-owns the paid order to the account created at first sign-in", async () => {
    const email = "first-time-buyer@example.com";
    await seedGuestBuyerWithPaidOrder(db, {
      guestId: "guest_ftb",
      email,
      orderId: "ord_ftb",
    });

    const service = createMagicLoginService({
      repository: createMagicLoginRepository(db),
    });
    const created = await service.createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "ftb-requester-key",
    });

    const exchange = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(exchange.statusCode, 200, exchange.body);
    const loginUserId = exchange.json().user_id;
    assert.ok(loginUserId, "login must resolve a user id");

    // The order the guest paid for is now owned by the signed-in account.
    const order = await db
      .prepare("SELECT user_id FROM web_orders WHERE id = ?")
      .get("ord_ftb");
    assert.equal(
      order.user_id,
      loginUserId,
      "paid order must be reclaimed to the login account",
    );
  });

  it("does not reclaim an order whose checkout email differs from the login email", async () => {
    await seedGuestBuyerWithPaidOrder(db, {
      guestId: "guest_other",
      email: "paid-with-this@example.com",
      orderId: "ord_other",
    });

    const service = createMagicLoginService({
      repository: createMagicLoginRepository(db),
    });
    const created = await service.createTransaction({
      email: "signs-in-with-that@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "other-requester-key",
    });

    const exchange = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(exchange.statusCode, 200, exchange.body);

    const order = await db
      .prepare("SELECT user_id FROM web_orders WHERE id = ?")
      .get("ord_other");
    assert.equal(
      order.user_id,
      "guest_other",
      "a mismatched-email login must not reach another buyer's order",
    );
  });
});
