"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-web-checkout-route-32bytes";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const authService = require("../../src/services/auth-service");
const {
  createGiftWalletRepository,
} = require("../../src/database/gift-wallet-repository");
const {
  createGiftReservationRepository,
} = require("../../src/database/gift-reservation-repository");
const {
  createGiftReservationService,
} = require("../../src/services/gift-reservation-service");
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
      token_count: 1,
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
    const createParams = stripe.calls.create[0];
    assert.match(createParams.cancel_url, /cancelled=1&order_id=worder_/);
    // consent_collection.promotions is country-gated (rejected in AU) — must not
    // be sent, it crashed every checkout with a 400.
    assert.equal(
      createParams.consent_collection,
      undefined,
      "must not send country-gated consent_collection",
    );
    // Collect the buyer's name for the account (fixes admin "No name").
    assert.equal(createParams.billing_address_collection, "auto");

    const order = await db.query(
      "SELECT status, user_id, amount_cents FROM web_orders WHERE track_version_id = ?",
      [versionId],
    );
    assert.equal(order.rows[0].status, "pending");
    assert.equal(order.rows[0].user_id, userId);
    assert.equal(order.rows[0].amount_cents, 1999);
  });

  it("uses one existing fungible gift credit without creating Stripe checkout", async () => {
    const { token, userId } = await seedActiveUserWithSession(
      db,
      "buyer_wallet_order",
    );
    const { trackId, versionId } = await seedTrackVersion(db, {
      userId,
      trackId: "trk_wallet_order",
      versionId: "trk_wallet_order_v1",
    });
    await db
      .prepare(
        "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 1, ?)",
      )
      .run(userId, NOW);

    const response = await app.inject({
      method: "POST",
      url: "/web/orders",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "wallet-order-1",
      },
      payload: {
        track_id: trackId,
        track_version_id: versionId,
        payment_method: "gift_credit",
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.json().order_id, /^worder_/);
    assert.equal(
      response.json().status_url,
      `/web/orders/by-id/${response.json().order_id}`,
    );
    assert.equal(stripe.calls.create.length, 0);

    const order = await db
      .prepare(
        `SELECT status, payment_source, funding_model, gift_reservation_id
         FROM web_orders WHERE id = ?`,
      )
      .get(response.json().order_id);
    assert.ok(["paid", "rendering"].includes(order.status));
    assert.equal(order.payment_source, "gift_wallet");
    assert.equal(order.funding_model, "gift_reservation_v1");
    assert.ok(order.gift_reservation_id);

    const wallet = await db
      .prepare("SELECT balance FROM gift_wallet WHERE user_id = ?")
      .get(userId);
    assert.equal(Number(wallet.balance), 0);
    const track = await db
      .prepare(
        "SELECT funding_source, gift_reservation_id FROM tracks WHERE id = ?",
      )
      .get(trackId);
    assert.equal(track.funding_source, "gift_wallet");
    assert.equal(track.gift_reservation_id, order.gift_reservation_id);

    const other = await seedTrackVersion(db, {
      userId,
      trackId: "trk_wallet_order_other",
      versionId: "trk_wallet_order_other_v1",
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/web/orders",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "wallet-order-1",
      },
      payload: {
        track_id: other.trackId,
        track_version_id: other.versionId,
        payment_method: "gift_credit",
      },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error, "IDEMPOTENCY_CONFLICT");
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
    assert.equal(Number(wallet.rows[0].balance), 0);
    const fundedOrder = await db
      .prepare(
        "SELECT funding_model, gift_reservation_id FROM web_orders WHERE id = 'worder_poll'",
      )
      .get();
    assert.equal(fundedOrder.funding_model, "gift_reservation_v1");
    assert.ok(fundedOrder.gift_reservation_id);

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
      0,
      "no duplicate grant or reserve on re-poll",
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

  it("recovers one exact owned order by order id", async () => {
    const { token, userId } = await seedActiveUserWithSession(db, "buyer_exact");
    const first = await seedTrackVersion(db, {
      userId,
      trackId: "trk_exact_1",
      versionId: "trk_exact_1_v1",
    });
    const second = await seedTrackVersion(db, {
      userId,
      trackId: "trk_exact_2",
      versionId: "trk_exact_2_v1",
    });
    for (const [id, sessionId, track] of [
      ["worder_exact_1", "cs_exact_1", first],
      ["worder_exact_2", "cs_exact_2", second],
    ]) {
      await db
        .prepare(
          `INSERT INTO web_orders (id, checkout_session_id, user_id, track_id, track_version_id, price_key, amount_cents, currency, status, render_attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'gift_song', 1999, 'usd', 'delivered', 0, ?, ?)`,
        )
        .run(id, sessionId, userId, track.trackId, track.versionId, NOW, NOW);
    }
    app.webOrderOrchestrator.describeOrderForStatus = async (order) => ({
      content_status: order.status,
      delivery_status: "ready_to_share",
    });

    const response = await app.inject({
      method: "GET",
      url: "/web/orders/by-id/worder_exact_1",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().order_reference, "worder_exact_1");
    assert.equal(response.json().content_status, "delivered");
    assert.equal(response.json().delivery_status, "ready_to_share");
  });

  it("does not expose an exact order owned by another user", async () => {
    const owner = await seedActiveUserWithSession(db, "buyer_exact_owner");
    const track = await seedTrackVersion(db, {
      userId: owner.userId,
      trackId: "trk_exact_private",
      versionId: "trk_exact_private_v1",
    });
    await db
      .prepare(
        `INSERT INTO web_orders (id, checkout_session_id, user_id, track_id, track_version_id, price_key, amount_cents, currency, status, render_attempts, created_at, updated_at)
         VALUES ('worder_exact_private', 'cs_exact_private', ?, ?, ?, 'gift_song', 1999, 'usd', 'paid', 0, ?, ?)`,
      )
      .run(owner.userId, track.trackId, track.versionId, NOW, NOW);
    const stranger = await seedActiveUserWithSession(db, "buyer_exact_stranger");

    const response = await app.inject({
      method: "GET",
      url: "/web/orders/by-id/worder_exact_private",
      headers: { authorization: `Bearer ${stranger.token}` },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "ORDER_NOT_FOUND");
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

  it("does not claw back a full gift bundle for a partial Stripe refund", async () => {
    const { userId } = await seedActiveUserWithSession(db, "buyer_partial_refund");
    const { trackId, versionId } = await seedTrackVersion(db, { userId });
    await db
      .prepare(
        "UPDATE web_products SET token_count = 3, active = 1 WHERE price_key = 'gift_song'",
      )
      .run();
    const walletRepository = createGiftWalletRepository(db);
    const purchase = await walletRepository.applyTransaction({
      userId,
      type: "purchase",
      amount: 3,
      source: "stripe_checkout",
      referenceType: "web_order",
      referenceId: "worder_partial_refund",
      idempotencyKey: "web_order_worder_partial_refund",
    });
    await db
      .prepare(
        `INSERT INTO web_orders (
          id, checkout_session_id, user_id, track_id, track_version_id,
          price_key, amount_cents, currency, status, render_attempts,
          payment_intent_id, payment_source, funding_model,
          purchase_transaction_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'gift_song', 1999, 'usd', 'delivered', 0, ?,
          'stripe', 'gift_reservation_v1', ?, ?, ?)`,
      )
      .run(
        "worder_partial_refund",
        "cs_partial_refund",
        userId,
        trackId,
        versionId,
        "pi_partial_refund",
        purchase.transactionId,
        NOW,
        NOW,
      );

    let stripeEvent = {
      id: "evt_partial_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_partial_refund",
          payment_intent: "pi_partial_refund",
          amount: 1999,
          amount_refunded: 500,
        },
      },
    };
    await app.close();
    stripe = fakeStripe({ constructEvent: () => stripeEvent });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: { stripeService: stripe },
    });
    await app.ready();

    const partial = await app.inject({
      method: "POST",
      url: "/web/webhooks/stripe",
      headers: { "stripe-signature": "test" },
      payload: {},
    });
    assert.equal(partial.statusCode, 200, partial.body);
    assert.equal(await walletRepository.getNetBalance(userId), 3);

    await db
      .prepare(
        "UPDATE web_products SET token_count = 1 WHERE price_key = 'gift_song'",
      )
      .run();
    stripeEvent = {
      ...stripeEvent,
      id: "evt_full_refund",
      data: {
        object: {
          ...stripeEvent.data.object,
          amount_refunded: 1999,
        },
      },
    };
    const full = await app.inject({
      method: "POST",
      url: "/web/webhooks/stripe",
      headers: { "stripe-signature": "test" },
      payload: {},
    });
    assert.equal(full.statusCode, 200, full.body);
    assert.equal(await walletRepository.getNetBalance(userId), 0);
  });

  it("atomically releases an unfinalized reservation before reversing its purchase grant", async () => {
    const { userId, token } = await seedActiveUserWithSession(
      db,
      "buyer_unfinalized_refund",
    );
    const { trackId, versionId } = await seedTrackVersion(db, {
      userId,
      trackId: "trk_unfinalized_refund",
      versionId: "trk_unfinalized_refund_v1",
    });
    await db
      .prepare(
        "UPDATE track_versions SET preview_url = ? WHERE id = ?",
      )
      .run("https://cdn.example.test/unfinalized-preview.mp3", versionId);
    const walletRepository = createGiftWalletRepository(db);
    const purchase = await walletRepository.applyTransaction({
      userId,
      type: "purchase",
      amount: 1,
      source: "stripe_checkout",
      referenceType: "web_order",
      referenceId: "worder_unfinalized_refund",
      idempotencyKey: "web_order_worder_unfinalized_refund",
    });
    const reservationService = createGiftReservationService({
      db,
      giftWalletRepository: walletRepository,
      giftReservationRepository: createGiftReservationRepository(db),
    });
    const { reservation } = await reservationService.reserveGiftCredit({
      userId,
      idempotencyKey: "reserve_unfinalized_refund",
      expiresAt: "2026-07-17T10:00:00.000Z",
      purpose: "paid_web_order",
      originWebOrderId: "worder_unfinalized_refund",
    });
    await db
      .prepare(
        `UPDATE gift_reservations
         SET status = 'content_ready', content_type = 'song', content_id = ?,
             version_num = 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(trackId, NOW, reservation.id);
    await db
      .prepare(
        `INSERT INTO web_orders (
          id, checkout_session_id, user_id, track_id, track_version_id,
          price_key, amount_cents, currency, status, render_attempts,
          payment_intent_id, payment_source, funding_model,
          purchase_transaction_id, gift_reservation_id, created_at, updated_at
        ) VALUES (
          'worder_unfinalized_refund', 'cs_unfinalized_refund', ?, ?, ?,
          'gift_song', 1999, 'usd', 'rendering', 0, 'pi_unfinalized_refund',
          'stripe', 'gift_reservation_v1', ?, ?, ?, ?
        )`,
      )
      .run(
        userId,
        trackId,
        versionId,
        purchase.transactionId,
        reservation.id,
        NOW,
        NOW,
      );

    await app.close();
    stripe = fakeStripe({
      constructEvent: () => ({
        id: "evt_unfinalized_refund",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_unfinalized_refund",
            payment_intent: "pi_unfinalized_refund",
            amount: 1999,
            amount_refunded: 1999,
          },
        },
      }),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: { stripeService: stripe },
    });
    await app.ready();

    const [response, finalizeResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/web/webhooks/stripe",
        headers: { "stripe-signature": "test" },
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/gifts/reservations/${reservation.id}/finalize`,
        headers: { authorization: `Bearer ${token}` },
        payload: { delivery_mode: "manual" },
      }),
    ]);
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(
      [200, 409].includes(finalizeResponse.statusCode),
      finalizeResponse.body,
    );
    const finalReservation = await db
      .prepare(
        "SELECT status, cancel_reason, gift_order_id FROM gift_reservations WHERE id = ?",
      )
      .get(reservation.id);
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM web_orders WHERE id = ?")
          .get("worder_unfinalized_refund")
      ).status,
      "refunded",
    );
    if (finalReservation.status === "refunded") {
      assert.equal(
        finalReservation.cancel_reason,
        "payment_refunded_before_finalization",
      );
      assert.equal(finalReservation.gift_order_id, null);
      assert.equal(await walletRepository.getNetBalance(userId), 0);
      assert.equal(finalizeResponse.statusCode, 409, finalizeResponse.body);
    } else {
      assert.equal(finalReservation.status, "finalized");
      assert.ok(finalReservation.gift_order_id);
      assert.equal(finalReservation.cancel_reason, null);
      assert.equal(await walletRepository.getNetBalance(userId), -1);
      assert.equal(finalizeResponse.statusCode, 200, finalizeResponse.body);
      assert.equal(
        (
          await db
            .prepare("SELECT status FROM share_tokens WHERE gift_order_id = ?")
            .get(finalReservation.gift_order_id)
        ).status,
        "active",
      );
    }
  });

  it("preserves a finalized gift when its fungible Stripe grant is refunded", async () => {
    const { userId } = await seedActiveUserWithSession(
      db,
      "buyer_finalized_refund",
    );
    const { trackId, versionId } = await seedTrackVersion(db, {
      userId,
      trackId: "trk_finalized_refund",
      versionId: "trk_finalized_refund_v1",
    });
    const walletRepository = createGiftWalletRepository(db);
    const purchase = await walletRepository.applyTransaction({
      userId,
      type: "purchase",
      amount: 1,
      source: "stripe_checkout",
      referenceType: "web_order",
      referenceId: "worder_finalized_refund",
      idempotencyKey: "web_order_worder_finalized_refund",
    });
    const reservationService = createGiftReservationService({
      db,
      giftWalletRepository: walletRepository,
      giftReservationRepository: createGiftReservationRepository(db),
    });
    const { reservation } = await reservationService.reserveGiftCredit({
      userId,
      idempotencyKey: "reserve_finalized_refund",
      expiresAt: "2026-07-17T10:00:00.000Z",
      purpose: "paid_web_order",
      originWebOrderId: "worder_finalized_refund",
    });

    await db
      .prepare(
        `INSERT INTO gift_orders (
          id, sender_user_id, content_type, content_id, status,
          dispatch_status, delivery_mode, send_at, sender_timezone,
          channels_json, share_token_id, share_url, claim_policy,
          expires_in_days, token_transaction_id, origin_web_order_id,
          created_at, updated_at
        ) VALUES (
          'gift_finalized_refund', ?, 'song', ?, 'ready_to_share',
          'pending', 'manual', ?, 'UTC', '[]', 'share_finalized_refund',
          'https://porizo.co/g/share_finalized_refund', 'app_only', 30, ?,
          'worder_finalized_refund', ?, ?
        )`,
      )
      .run(
        userId,
        trackId,
        NOW,
        reservation.token_transaction_id,
        NOW,
        NOW,
      );
    await db
      .prepare(
        `INSERT INTO share_tokens (
          id, track_id, track_version_id, creator_id, gift_order_id,
          status, share_type, claim_policy, web_stream_allowed,
          app_save_allowed, expires_at, created_at
        ) VALUES (
          'share_finalized_refund', ?, ?, ?, 'gift_finalized_refund',
          'active', 'gift', 'app_only', 1, 1, ?, ?
        )`,
      )
      .run(trackId, versionId, userId, "2026-08-16T10:00:00.000Z", NOW);
    await db
      .prepare(
        `UPDATE gift_reservations
         SET status = 'finalized', content_type = 'song', content_id = ?,
             version_num = 1, gift_order_id = 'gift_finalized_refund',
             updated_at = ?
         WHERE id = ?`,
      )
      .run(trackId, NOW, reservation.id);
    await db
      .prepare(
        `INSERT INTO web_orders (
          id, checkout_session_id, user_id, track_id, track_version_id,
          price_key, amount_cents, currency, status, render_attempts,
          payment_intent_id, payment_source, funding_model,
          purchase_transaction_id, gift_reservation_id, created_at, updated_at
        ) VALUES (
          'worder_finalized_refund', 'cs_finalized_refund', ?, ?, ?,
          'gift_song', 1999, 'usd', 'delivered', 0, 'pi_finalized_refund',
          'stripe', 'gift_reservation_v1', ?, ?, ?, ?
        )`,
      )
      .run(
        userId,
        trackId,
        versionId,
        purchase.transactionId,
        reservation.id,
        NOW,
        NOW,
      );

    await app.close();
    stripe = fakeStripe({
      constructEvent: () => ({
        id: "evt_finalized_refund",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_finalized_refund",
            payment_intent: "pi_finalized_refund",
            amount: 1999,
            amount_refunded: 1999,
          },
        },
      }),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
      webFunnelServices: { stripeService: stripe },
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/web/webhooks/stripe",
      headers: { "stripe-signature": "test" },
      payload: {},
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM web_orders WHERE id = ?")
          .get("worder_finalized_refund")
      ).status,
      "refunded",
    );
    const gift = await db
      .prepare(
        "SELECT status FROM gift_orders WHERE id = ?",
      )
      .get("gift_finalized_refund");
    assert.deepEqual(gift, { status: "ready_to_share" });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, cancel_reason FROM gift_reservations WHERE id = ?",
        )
        .get(reservation.id),
      { status: "finalized", cancel_reason: null },
    );
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM share_tokens WHERE id = ?")
          .get("share_finalized_refund")
      ).status,
      "active",
    );
    assert.equal(await walletRepository.getNetBalance(userId), -1);
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
