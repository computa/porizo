"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-web-checkout-route-32bytes";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const authService = require("../../src/services/auth-service");
const {
  setFeatureFlag,
  clearCache,
} = require("../../src/services/feature-flags");

const NOW = "2026-07-16T10:00:00.000Z";

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

// A fake Stripe service capturing calls; deterministic session ids.
function fakeStripe(overrides = {}) {
  const calls = { create: [], retrieve: [], refund: [] };
  let sessionSeq = 0;
  return {
    calls,
    webhookSecret: "whsec_test",
    constructEvent: overrides.constructEvent || (() => ({})),
    createCheckoutSession: async (params) => {
      calls.create.push(params);
      sessionSeq += 1;
      return {
        id: overrides.sessionId || `cs_test_${sessionSeq}`,
        url: `https://checkout.stripe.test/${sessionSeq}`,
        amount_total: 1999,
        currency: "usd",
        status: "open",
      };
    },
    retrieveCheckoutSession: async (id) => {
      calls.retrieve.push(id);
      return overrides.retrieve
        ? overrides.retrieve(id)
        : {
            id,
            status: "open",
            url: `https://checkout.stripe.test/reuse/${id}`,
          };
    },
    createRefund: async (params) => {
      calls.refund.push(params);
      return { id: "re_1" };
    },
  };
}

async function seedActiveUserWithSession(db, userId = "buyer_1") {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', 'active')",
    )
    .run(userId, NOW);
  const session = await authService.createSession(userId, {
    platform: "web",
    authMethod: "web_guest",
  });
  const token = authService.generateAccessToken(userId, {
    sessionId: session.id,
  });
  return { userId, sessionId: session.id, token };
}

async function seedTrackVersion(
  db,
  { userId, trackId = "trk_1", versionId = "trk_1_v1" },
) {
  await db
    .prepare(
      `INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, voice_mode, message, created_at, updated_at)
       VALUES (?, ?, 'complete', 'Sarah''s Song', 'i_love_you', 'Sarah', 'acoustic', 'ai_voice', 'For you', ?, ?)`,
    )
    .run(trackId, userId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, lyrics_status, created_at)
       VALUES (?, ?, 1, 'preview_ready', 'full', ?, 'approved', ?)`,
    )
    .run(versionId, trackId, `${trackId}_hash`, NOW);
  return { trackId, versionId };
}

async function activateProduct(db) {
  await db
    .prepare(
      "UPDATE web_products SET active = 1, stripe_price_id = 'price_live_1' WHERE price_key = 'gift_song'",
    )
    .run();
}

describe("Web checkout + orders", () => {
  let db;
  let app;
  let stripe;

  beforeEach(async () => {
    clearCache();
    db = await initDb();
    await setFeatureFlag(db, "web_funnel_enabled", true, "test");
    stripe = fakeStripe();
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: { stripeService: stripe },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    clearCache();
  });

  it("returns active products with server-stored localized price", async () => {
    await activateProduct(db);
    const res = await app.inject({ method: "GET", url: "/web/products" });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.products.length, 1);
    assert.deepEqual(body.products[0], {
      price_key: "gift_song",
      localized_price: "$19.99",
      currency: "usd",
      name: "Gift Song",
    });
  });

  it("creates a checkout session and a pending order for the track owner", async () => {
    await activateProduct(db);
    const { token, userId } = await seedActiveUserWithSession(db);
    const { trackId, versionId } = await seedTrackVersion(db, { userId });

    const res = await app.inject({
      method: "POST",
      url: "/web/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        track_id: trackId,
        track_version_id: versionId,
        price_key: "gift_song",
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.json().checkout_url, /checkout\.stripe\.test/);
    assert.match(
      stripe.calls.create[0].cancel_url,
      /cancelled=1&order_id=worder_/,
    );

    const order = await db.query(
      "SELECT status, user_id, amount_cents FROM web_orders WHERE track_version_id = ?",
      [versionId],
    );
    assert.equal(order.rows[0].status, "pending");
    assert.equal(order.rows[0].user_id, userId);
    assert.equal(order.rows[0].amount_cents, 1999);
  });

  it("restores an owned pending order draft after checkout cancellation", async () => {
    await activateProduct(db);
    const { token, userId } = await seedActiveUserWithSession(db);
    const { trackId, versionId } = await seedTrackVersion(db, { userId });
    await db
      .prepare(
        `INSERT INTO web_orders
         (id, checkout_session_id, user_id, track_id, track_version_id,
          price_key, amount_cents, currency, status, render_attempts,
          created_at, updated_at)
         VALUES ('worder_cancel', 'cs_cancel', ?, ?, ?, 'gift_song', 1999,
                 'usd', 'pending', 0, ?, ?)`,
      )
      .run(userId, trackId, versionId, NOW, NOW);

    const response = await app.inject({
      method: "GET",
      url: "/web/order-drafts/worder_cancel",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      track_id: trackId,
      track_version_id: versionId,
      version_num: 1,
      recipient_name: "Sarah",
    });
  });

  it("rejects checkout for a track the caller does not own", async () => {
    await activateProduct(db);
    const { token } = await seedActiveUserWithSession(db, "buyer_a");
    await seedActiveUserWithSession(db, "buyer_b");
    const { trackId, versionId } = await seedTrackVersion(db, {
      userId: "buyer_b",
      trackId: "trk_b",
      versionId: "trk_b_v1",
    });
    const res = await app.inject({
      method: "POST",
      url: "/web/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        track_id: trackId,
        track_version_id: versionId,
        price_key: "gift_song",
      },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "TRACK_NOT_FOUND");
  });

  it("rejects a version id that belongs to a different owned track", async () => {
    await activateProduct(db);
    const { token, userId } = await seedActiveUserWithSession(db);
    const first = await seedTrackVersion(db, {
      userId,
      trackId: "trk_first",
      versionId: "trk_first_v1",
    });
    const second = await seedTrackVersion(db, {
      userId,
      trackId: "trk_second",
      versionId: "trk_second_v1",
    });

    const response = await app.inject({
      method: "POST",
      url: "/web/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        track_id: first.trackId,
        track_version_id: second.versionId,
        price_key: "gift_song",
      },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "TRACK_NOT_FOUND");
    assert.equal(stripe.calls.create.length, 0);
  });

  it("blocks checkout with 409 when PREVIEW_ONLY is set", async () => {
    await activateProduct(db);
    await app.close();
    stripe = fakeStripe();
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage", PREVIEW_ONLY: true },
      storage: storageStub(),
      webFunnelServices: { stripeService: stripe },
    });
    await app.ready();
    const { token, userId } = await seedActiveUserWithSession(db);
    const { trackId, versionId } = await seedTrackVersion(db, { userId });
    const res = await app.inject({
      method: "POST",
      url: "/web/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        track_id: trackId,
        track_version_id: versionId,
        price_key: "gift_song",
      },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "FULL_RENDERS_DISABLED");
  });

  it("reuses one pending order + session across two tabs", async () => {
    await activateProduct(db);
    const { token, userId } = await seedActiveUserWithSession(db);
    const { trackId, versionId } = await seedTrackVersion(db, { userId });
    const payload = {
      track_id: trackId,
      track_version_id: versionId,
      price_key: "gift_song",
    };
    const first = await app.inject({
      method: "POST",
      url: "/web/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(first.statusCode, 200, first.body);
    const second = await app.inject({
      method: "POST",
      url: "/web/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(second.statusCode, 200, second.body);
    const orders = await db.query(
      "SELECT COUNT(*) AS c FROM web_orders WHERE status = 'pending' AND track_version_id = ?",
      [versionId],
    );
    assert.equal(Number(orders.rows[0].c), 1);
    // The second tab reused the session via retrieve, so only one create call.
    assert.equal(stripe.calls.create.length, 1);
    assert.equal(stripe.calls.retrieve.length, 1);
  });

  it("orders poll recovers a webhook-lost payment via direct Stripe retrieve (once)", async () => {
    await activateProduct(db);
    const { token, userId } = await seedActiveUserWithSession(db);
    const { trackId, versionId } = await seedTrackVersion(db, { userId });
    // Seed a pending order whose webhook never arrived.
    await db
      .prepare(
        `INSERT INTO web_orders (id, checkout_session_id, user_id, track_id, track_version_id, price_key, amount_cents, currency, status, render_attempts, created_at, updated_at)
         VALUES ('worder_poll', 'cs_poll', ?, ?, ?, 'gift_song', 1999, 'usd', 'pending', 0, ?, ?)`,
      )
      .run(userId, trackId, versionId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
      )
      .run(userId, NOW);

    // Stripe reports the session as paid on retrieve.
    stripe = fakeStripe({
      retrieve: () => ({
        id: "cs_poll",
        payment_status: "paid",
        payment_intent: "pi_poll",
        customer_details: { email: "buyer@example.com" },
      }),
    });
    await app.close();
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: { stripeService: stripe },
    });
    let ticks = 0;
    app.webOrderOrchestrator.tick = async () => {
      ticks += 1;
      return { status: "stubbed" };
    };
    app.webOrderOrchestrator.describeOrderForStatus = async (order) => ({
      status: order.status,
      recipient_name: "Sarah",
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/web/orders/cs_poll",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().status, "paid");

    const order = await db.query(
      "SELECT status FROM web_orders WHERE id = 'worder_poll'",
    );
    assert.equal(order.rows[0].status, "paid");
    const wallet = await db.query(
      "SELECT balance FROM gift_wallet WHERE user_id = ?",
      [userId],
    );
    assert.equal(Number(wallet.rows[0].balance), 1);

    // Poll again — already paid, no second grant.
    await app.inject({
      method: "GET",
      url: "/web/orders/cs_poll",
      headers: { authorization: `Bearer ${token}` },
    });
    const walletAfter = await db.query(
      "SELECT balance FROM gift_wallet WHERE user_id = ?",
      [userId],
    );
    assert.equal(
      Number(walletAfter.rows[0].balance),
      1,
      "no double grant on re-poll",
    );
    assert.equal(ticks, 1, "orchestrator kicked once");
  });

  it("recovers the latest owned order with no session_id (cross-device sign-in)", async () => {
    const { token, userId } = await seedActiveUserWithSession(db, "buyer_x");
    const { trackId, versionId } = await seedTrackVersion(db, {
      userId,
      trackId: "trk_x",
      versionId: "trk_x_v1",
    });
    await db
      .prepare(
        `INSERT INTO web_orders (id, checkout_session_id, user_id, track_id, track_version_id, price_key, amount_cents, currency, status, render_attempts, created_at, updated_at)
         VALUES ('worder_x', 'cs_x', ?, ?, ?, 'gift_song', 1999, 'usd', 'delivered', 0, ?, ?)`,
      )
      .run(userId, trackId, versionId, NOW, NOW);
    app.webOrderOrchestrator.describeOrderForStatus = async (order) => ({
      status: order.status,
      recipient_name: "Sarah",
    });

    const res = await app.inject({
      method: "GET",
      url: "/web/orders/latest",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().status, "delivered");
    assert.equal(res.json().checkout_session_id, "cs_x");
    assert.equal(res.json().order_reference, "worder_x");
  });

  it("never returns another user's order from /web/orders/latest", async () => {
    // buyer_y owns an order; buyer_z (a different signed-in account) must not see it.
    const buyerY = await seedActiveUserWithSession(db, "buyer_y");
    const { trackId, versionId } = await seedTrackVersion(db, {
      userId: buyerY.userId,
      trackId: "trk_y",
      versionId: "trk_y_v1",
    });
    await db
      .prepare(
        `INSERT INTO web_orders (id, checkout_session_id, user_id, track_id, track_version_id, price_key, amount_cents, currency, status, render_attempts, created_at, updated_at)
         VALUES ('worder_y', 'cs_y', ?, ?, ?, 'gift_song', 1999, 'usd', 'delivered', 0, ?, ?)`,
      )
      .run(buyerY.userId, trackId, versionId, NOW, NOW);

    const buyerZ = await seedActiveUserWithSession(db, "buyer_z");
    const res = await app.inject({
      method: "GET",
      url: "/web/orders/latest",
      headers: { authorization: `Bearer ${buyerZ.token}` },
    });
    assert.equal(res.statusCode, 404, res.body);
  });
});

describe("deploy-before-setup: production boots without Stripe/Turnstile keys", () => {
  let db;
  let app;
  const savedEnv = {};

  beforeEach(async () => {
    for (const key of [
      "CORS_ORIGIN",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "TURNSTILE_SECRET_KEY",
      "TRUST_CLOUDFLARE_CLIENT_IP",
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.CORS_ORIGIN = "https://porizo.co";
    process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.TURNSTILE_SECRET_KEY;

    db = await initDb();
    // No webFunnelServices injection: this exercises the REAL construction
    // path exactly as a production deploy without keys would.
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage", NODE_ENV: "production" },
      storage: storageStub(),
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearCache();
  });

  it("boots, and the Stripe webhook fails closed with 503", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/web/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=x",
      },
      payload: "{}",
    });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().error, "WEBHOOK_UNCONFIGURED");
  });
});
