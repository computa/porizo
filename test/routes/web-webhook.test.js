"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-web-webhook-route-32bytes";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const {
  setFeatureFlag,
  clearCache,
} = require("../../src/services/feature-flags");
const { createStripeService } = require("../../src/services/stripe-service");

const NOW = "2026-07-16T10:00:00.000Z";
const WEBHOOK_SECRET = "whsec_test_web_funnel";

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

// Real Stripe instance only for signing test events; a fake API client handles
// checkout/refund so nothing hits the network.
function buildStripeService(overrides = {}) {
  const service = createStripeService({
    secretKey: "sk_test_fake",
    webhookSecret: WEBHOOK_SECRET,
    environment: "test",
    client: {
      checkout: {
        sessions: { create: async () => ({}), retrieve: async () => ({}) },
      },
      refunds: { create: async () => ({ id: "re_1" }) },
    },
  });
  return { ...service, ...overrides };
}

function signedRequest(app, event, { secret = WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify(event);
  const signer = new Stripe("sk_test_fake", { apiVersion: "2024-06-20" });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return app.inject({
    method: "POST",
    url: "/web/webhooks/stripe",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    payload,
  });
}

async function seedGuestUser(db, userId = "guest_1") {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', 'guest')",
    )
    .run(userId, NOW);
  await db
    .prepare(
      "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
    )
    .run(userId, NOW);
}

async function seedPendingOrder(
  db,
  { orderId = "worder_1", userId = "guest_1", sessionId = "cs_test_1" } = {},
) {
  await db
    .prepare(
      `INSERT INTO tracks (
         id, user_id, status, title, occasion, recipient_name, style,
         voice_mode, message, created_at, updated_at
       ) VALUES (
         'trk_1', ?, 'complete', 'Sarah''s Song', 'i_love_you', 'Sarah',
         'acoustic', 'ai_voice', 'For you', ?, ?
       )`,
    )
    .run(userId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_hash,
         lyrics_status, created_at
       ) VALUES (
         'trk_1_v1', 'trk_1', 1, 'preview_ready', 'full',
         'trk_1_hash', 'approved', ?
       )`,
    )
    .run(NOW);
  await db
    .prepare(
      `INSERT INTO web_orders (
         id, checkout_session_id, user_id, track_id, track_version_id,
         price_key, amount_cents, currency, status, render_attempts, created_at, updated_at
       ) VALUES (?, ?, ?, 'trk_1', 'trk_1_v1', 'gift_song', 1999, 'usd', 'pending', 0, ?, ?)`,
    )
    .run(orderId, sessionId, userId, NOW, NOW);
  return { orderId, sessionId, userId };
}

function completedEvent(
  sessionId,
  { email = "buyer@example.com", pi = "pi_1" } = {},
) {
  return {
    id: `evt_${sessionId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: pi,
        customer_details: { email },
      },
    },
  };
}

describe("Stripe webhook", () => {
  let db;
  let app;
  let tickCalls;

  beforeEach(async () => {
    clearCache();
    db = await initDb();
    await setFeatureFlag(db, "web_funnel_enabled", true, "test");
    tickCalls = [];
    // Activate the product so the token grant reads token_count = 1.
    await db
      .prepare(
        "UPDATE web_products SET active = 1, stripe_price_id = 'price_live_1' WHERE price_key = 'gift_song'",
      )
      .run();
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: {
        stripeService: buildStripeService(),
      },
    });
    // Neutralize the orchestrator so the webhook test isolates the money path.
    app.webOrderOrchestrator.tick = async (orderId) => {
      tickCalls.push(orderId);
      return { status: "stubbed" };
    };
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    clearCache();
  });

  it("marks the order paid and grants exactly one token; a replay does not double-grant", async () => {
    await seedGuestUser(db);
    const { orderId, sessionId } = await seedPendingOrder(db);

    const first = await signedRequest(app, completedEvent(sessionId));
    assert.equal(first.statusCode, 200, first.body);

    let order = await db.query(
      "SELECT status, email, payment_intent_id FROM web_orders WHERE id = ?",
      [orderId],
    );
    assert.equal(order.rows[0].status, "paid");
    assert.equal(order.rows[0].email, "buyer@example.com");
    assert.equal(order.rows[0].payment_intent_id, "pi_1");

    let wallet = await db.query(
      "SELECT balance FROM gift_wallet WHERE user_id = 'guest_1'",
    );
    assert.equal(
      Number(wallet.rows[0].balance),
      0,
      "the purchased token is immediately reserved for this paid order",
    );
    let ledger = await db.query(
      `SELECT type, COUNT(*) AS count
       FROM gift_wallet_transactions
       WHERE user_id = 'guest_1'
       GROUP BY type
       ORDER BY type`,
    );
    assert.deepEqual(
      ledger.rows.map((row) => [row.type, Number(row.count)]),
      [
        ["gift_reserve", 1],
        ["purchase", 1],
      ],
    );

    // Replay the identical webhook.
    const replay = await signedRequest(app, completedEvent(sessionId));
    assert.equal(replay.statusCode, 200, replay.body);
    wallet = await db.query(
      "SELECT balance FROM gift_wallet WHERE user_id = 'guest_1'",
    );
    assert.equal(
      Number(wallet.rows[0].balance),
      0,
      "replay must not double-grant or reserve again",
    );
    ledger = await db.query(
      `SELECT type, COUNT(*) AS count
       FROM gift_wallet_transactions
       WHERE user_id = 'guest_1'
       GROUP BY type
       ORDER BY type`,
    );
    assert.deepEqual(
      ledger.rows.map((row) => [row.type, Number(row.count)]),
      [
        ["gift_reserve", 1],
        ["purchase", 1],
      ],
    );
    assert.equal(tickCalls.length, 1, "orchestrator tick fires once");
  });

  it("rejects an invalid signature with 400 and changes no state", async () => {
    await seedGuestUser(db);
    const { orderId, sessionId } = await seedPendingOrder(db);
    const bad = await app.inject({
      method: "POST",
      url: "/web/webhooks/stripe",
      headers: {
        "stripe-signature": "t=1,v1=deadbeef",
        "content-type": "application/json",
      },
      payload: JSON.stringify(completedEvent(sessionId)),
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error, "INVALID_SIGNATURE");
    const order = await db.query("SELECT status FROM web_orders WHERE id = ?", [
      orderId,
    ]);
    assert.equal(order.rows[0].status, "pending");
  });

  it("acknowledges an unknown event type with 200 and no state change", async () => {
    await seedGuestUser(db);
    const { orderId } = await seedPendingOrder(db);
    const res = await signedRequest(app, {
      id: "evt_x",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_x" } },
    });
    assert.equal(res.statusCode, 200);
    const order = await db.query("SELECT status FROM web_orders WHERE id = ?", [
      orderId,
    ]);
    assert.equal(order.rows[0].status, "pending");
  });

  it("expires a pending order to abandoned", async () => {
    await seedGuestUser(db);
    const { orderId, sessionId } = await seedPendingOrder(db);
    const res = await signedRequest(app, {
      id: "evt_exp",
      type: "checkout.session.expired",
      data: { object: { id: sessionId } },
    });
    assert.equal(res.statusCode, 200);
    const order = await db.query("SELECT status FROM web_orders WHERE id = ?", [
      orderId,
    ]);
    assert.equal(order.rows[0].status, "abandoned");
  });

  it("refunds revoke the gift share and mark the order refunded", async () => {
    await seedGuestUser(db);
    const { orderId, sessionId } = await seedPendingOrder(db);
    // Bring the order to paid + delivered with a share token.
    await db
      .prepare(
        "UPDATE web_orders SET status = 'delivered', payment_intent_id = 'pi_1', share_token_id = 'sh_1' WHERE id = ?",
      )
      .run(orderId);
    await db
      .prepare(
        `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, web_stream_allowed, app_save_allowed, expires_at, created_at, access_count)
         VALUES ('sh_1', 'trk_1', 'trk_1_v1', 'guest_1', 'unbound', 'gift', 1, 1, '9999-12-31T00:00:00.000Z', ?, 0)`,
      )
      .run(NOW);

    const res = await signedRequest(app, {
      id: "evt_refund",
      type: "charge.refunded",
      data: { object: { id: "ch_1", payment_intent: "pi_1" } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const order = await db.query("SELECT status FROM web_orders WHERE id = ?", [
      orderId,
    ]);
    assert.equal(order.rows[0].status, "refunded");
    const share = await db.query(
      "SELECT status FROM share_tokens WHERE id = 'sh_1'",
    );
    assert.equal(share.rows[0].status, "revoked");
  });

  it("keeps the pg CHECK migration in sync for the stripe_checkout contact source", async () => {
    const fs = require("fs");
    const path = require("path");
    const pg = fs.readFileSync(
      path.join(
        __dirname,
        "../../migrations/pg/133_user_contacts_stripe_source.sql",
      ),
      "utf8",
    );
    assert.match(pg, /stripe_checkout/);
    assert.match(pg, /user_contacts_source_check/);
    // The prior magic_link value must survive the CHECK rebuild.
    assert.match(pg, /magic_link/);
  });
});
