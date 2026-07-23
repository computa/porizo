"use strict";

process.env.NODE_ENV = "test";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const {
  createWebOrderOrchestrator,
} = require("../../src/services/web-order-orchestrator");

const NOW = "2026-07-16T10:00:00.000Z";

async function seedOrder(
  db,
  {
    orderId = "worder_1",
    status = "paid",
    userId = "u_1",
    attempts = 0,
    email = "buyer@example.com",
    buyerName = null,
  } = {},
) {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', 'active')",
    )
    .run(userId, NOW);
  await db
    .prepare(
      `INSERT INTO web_orders (
         id, checkout_session_id, user_id, track_id, track_version_id,
         price_key, amount_cents, currency, email, buyer_name, status, render_attempts, payment_intent_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'trk_1', 'trk_1_v1', 'gift_song', 1999, 'usd', ?, ?, ?, ?, 'pi_1', ?, ?)`,
    )
    .run(
      orderId,
      `cs_${orderId}`,
      userId,
      email,
      buyerName,
      status,
      attempts,
      "2020-01-01T00:00:00.000Z",
      "2020-01-01T00:00:00.000Z",
    );
  return { orderId, userId };
}

function makeDeps(overrides = {}) {
  const calls = {
    render: [],
    share: 0,
    delivery: [],
    apology: 0,
    refund: 0,
    alert: [],
    titleUpdates: [],
  };
  const deps = {
    renderFullVersion: async (args) => {
      calls.render.push(args);
    },
    getVersionRenderState:
      overrides.getVersionRenderState ||
      (async () => ({ ready: false, failed: false })),
    createGiftShare: async () => {
      calls.share += 1;
      return { shareId: "sh_1", shareUrl: "https://porizo.co/play/sh_1" };
    },
    sendDeliveryEmail: async (args) => {
      calls.delivery.push(args);
    },
    sendApologyEmail: async () => {
      calls.apology += 1;
    },
    refundOrder:
      overrides.refundOrder ||
      (async () => {
        calls.refund += 1;
      }),
    alertAdmin: async (args) => {
      calls.alert.push(args);
    },
    getTrackMeta:
      overrides.getTrackMeta ||
      (async () => ({ recipientName: "Sarah", occasion: null, title: null })),
    updateTrackTitle: async (args) => {
      calls.titleUpdates.push(args);
    },
    logger: { error: () => {}, info: () => {} },
    ...overrides.extra,
  };
  return { deps, calls };
}

describe("web order orchestrator", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  it("paid -> rendering kicks exactly one render", async () => {
    await seedOrder(db, { status: "paid" });
    const { deps, calls } = makeDeps();
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const result = await orch.tick("worder_1");
    assert.equal(result.status, "rendering");
    assert.equal(calls.render.length, 1);
    const order = await db.query(
      "SELECT status FROM web_orders WHERE id = 'worder_1'",
    );
    assert.equal(order.rows[0].status, "rendering");
  });

  it("backfills the title with 'by {sender}' at paid using the buyer name", async () => {
    await seedOrder(db, { status: "paid", buyerName: "Ambrose Obimma" });
    const { deps, calls } = makeDeps({
      getTrackMeta: async () => ({
        recipientName: "Chioma",
        occasion: "thank_you",
        title: "A Thank You Song for Chioma",
      }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    await orch.tick("worder_1");
    assert.equal(calls.titleUpdates.length, 1);
    assert.equal(calls.titleUpdates[0].trackId, "trk_1");
    assert.equal(
      calls.titleUpdates[0].title,
      "A Thank You Song for Chioma by Ambrose",
    );
  });

  it("does not backfill the title when there is no buyer name", async () => {
    await seedOrder(db, { status: "paid", buyerName: null });
    const { deps, calls } = makeDeps({
      getTrackMeta: async () => ({
        recipientName: "Chioma",
        occasion: "thank_you",
        title: "A Thank You Song for Chioma",
      }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    await orch.tick("worder_1");
    assert.equal(calls.titleUpdates.length, 0);
  });

  it("does not re-append 'by' when the title already has a sender", async () => {
    await seedOrder(db, { status: "paid", buyerName: "Someone" });
    const { deps, calls } = makeDeps({
      getTrackMeta: async () => ({
        recipientName: "Chioma",
        occasion: "thank_you",
        title: "A Thank You Song for Chioma by Ambrose",
      }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    await orch.tick("worder_1");
    assert.equal(calls.titleUpdates.length, 0);
  });

  it("rendering -> delivered creates one share and sends one delivery email", async () => {
    await seedOrder(db, { status: "rendering" });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: true, failed: false }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const result = await orch.tick("worder_1");
    assert.equal(result.status, "delivered");
    assert.equal(calls.share, 1);
    assert.equal(calls.delivery.length, 1);
    const order = await db.query(
      "SELECT status, share_token_id FROM web_orders WHERE id = 'worder_1'",
    );
    assert.equal(order.rows[0].status, "delivered");
    assert.equal(order.rows[0].share_token_id, "sh_1");
  });

  it("does not mark an Etsy order delivered before its durable MP3 is ready", async () => {
    await seedOrder(db, { status: "rendering" });
    let artifactReady = false;
    let fulfilmentDelivered = 0;
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: true, failed: false }),
      extra: {
        ensureRequiredArtifact: async () => ({
          required: true,
          ready: artifactReady,
        }),
        markFulfilmentDelivered: async () => {
          fulfilmentDelivered += 1;
        },
      },
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const pending = await orch.tick("worder_1");
    assert.equal(pending.status, "rendering");
    assert.equal(pending.artifactPending, true);
    assert.equal(calls.share, 0);
    assert.equal(fulfilmentDelivered, 0);

    artifactReady = true;
    const delivered = await orch.tick("worder_1");
    assert.equal(delivered.status, "delivered");
    assert.equal(calls.share, 1);
    assert.equal(fulfilmentDelivered, 1);
  });

  it("finalizes the common gift reservation without buyer-email delivery", async () => {
    await seedOrder(db, { status: "rendering" });
    await db
      .prepare(
        "UPDATE web_orders SET funding_model = 'gift_reservation_v1', gift_reservation_id = 'gres_web_1' WHERE id = 'worder_1'",
      )
      .run();
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: true, failed: false }),
      extra: {
        finalizeGiftOrder: async () => {
          await db
            .prepare(
              "UPDATE web_orders SET status = 'delivered', share_token_id = ? WHERE id = ? AND status = 'rendering'",
            )
            .run("sh_common", "worder_1");
          return {
            shareId: "sh_common",
            shareUrl: "https://porizo.co/play/sh_common",
            orderDelivered: true,
            orderTransitioned: true,
          };
        },
      },
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const result = await orch.tick("worder_1");
    assert.equal(result.status, "delivered");
    assert.equal(calls.share, 0, "legacy share creation is bypassed");
    assert.equal(calls.delivery.length, 0, "buyer receipt is not recipient delivery");
    const order = await db
      .prepare("SELECT share_token_id FROM web_orders WHERE id = ?")
      .get("worder_1");
    assert.equal(order.share_token_id, "sh_common");
  });

  it("still delivers when the delivery email fails (email is best-effort, not a gate)", async () => {
    await seedOrder(db, { status: "rendering" });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: true, failed: false }),
      extra: {
        sendDeliveryEmail: async () => {
          calls.delivery.push("attempted");
          throw new Error("Resend rejected the recipient");
        },
      },
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const result = await orch.tick("worder_1");
    // A paid, rendered order with a created share MUST reach delivered even if
    // the notification email throws — the song exists; email is not a gate.
    assert.equal(result.status, "delivered");
    assert.equal(calls.share, 1);
    assert.equal(calls.delivery.length, 1, "email was attempted once");
    const order = await db.query(
      "SELECT status, share_token_id FROM web_orders WHERE id = 'worder_1'",
    );
    assert.equal(order.rows[0].status, "delivered");
    assert.equal(order.rows[0].share_token_id, "sh_1");
  });

  it("re-running a delivered order is a no-op (idempotent side effects)", async () => {
    await seedOrder(db, { status: "rendering" });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: true, failed: false }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });
    await orch.tick("worder_1");
    const again = await orch.tick("worder_1");
    assert.equal(again.terminal, true);
    assert.equal(calls.share, 1, "no second share");
    assert.equal(calls.delivery.length, 1, "no second email");
  });

  it("3 render failures -> refund once + apology + admin alert; wallet not restored", async () => {
    // Start at attempt 2 so the next failure is the 3rd (triggers refund).
    await seedOrder(db, { status: "rendering", attempts: 2 });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: false, failed: true }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const result = await orch.tick("worder_1");
    assert.equal(result.status, "refunded");
    assert.equal(calls.refund, 1);
    assert.equal(calls.apology, 1);
    assert.ok(calls.alert.length >= 1, "admin alerted");
    const order = await db.query(
      "SELECT status FROM web_orders WHERE id = 'worder_1'",
    );
    assert.equal(order.rows[0].status, "refunded");
  });

  it("restores only the reserved credit when a common-wallet render fails", async () => {
    await seedOrder(db, { status: "rendering", attempts: 2 });
    await db
      .prepare(
        "UPDATE web_orders SET funding_model = 'gift_reservation_v1', gift_reservation_id = 'gres_failed' WHERE id = 'worder_1'",
      )
      .run();
    let reservationRefunds = 0;
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: false, failed: true }),
      extra: {
        refundGiftReservation: async () => {
          reservationRefunds += 1;
        },
      },
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const result = await orch.tick("worder_1");
    assert.equal(result.status, "failed");
    assert.equal(result.reservationRefunded, true);
    assert.equal(reservationRefunds, 1);
    assert.equal(calls.refund, 0, "Stripe purchase remains a fungible wallet grant");
  });

  it("retries the render when failures remain under the cap", async () => {
    await seedOrder(db, { status: "rendering", attempts: 0 });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: false, failed: true }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });
    const result = await orch.tick("worder_1");
    assert.equal(result.status, "rendering");
    assert.equal(result.retried, true);
    assert.equal(calls.render.length, 1);
    assert.equal(calls.refund, 0);
    const order = await db.query(
      "SELECT render_attempts FROM web_orders WHERE id = 'worder_1'",
    );
    assert.equal(Number(order.rows[0].render_attempts), 1);
  });

  it("refund API failure -> order failed + LOUD admin alert (never silent)", async () => {
    await seedOrder(db, { status: "rendering", attempts: 2 });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: false, failed: true }),
      refundOrder: async () => {
        throw new Error("stripe refund down");
      },
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });
    const result = await orch.tick("worder_1");
    assert.equal(result.status, "failed");
    assert.equal(result.refundFailed, true);
    const order = await db.query(
      "SELECT status FROM web_orders WHERE id = 'worder_1'",
    );
    assert.equal(order.rows[0].status, "failed");
    assert.ok(
      calls.alert.some((a) => /URGENT/.test(a.subject)),
      "loud admin alert fired",
    );
  });

  it("sweep resumes a stale rendering order to delivered without a duplicate email", async () => {
    await seedOrder(db, { status: "rendering" });
    const { deps, calls } = makeDeps({
      getVersionRenderState: async () => ({ ready: true, failed: false }),
    });
    const orch = createWebOrderOrchestrator({ db, ...deps });

    const results = await orch.sweepWebOrders();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "delivered");
    assert.equal(calls.delivery.length, 1);

    // A second sweep finds nothing resumable (order is terminal).
    const second = await orch.sweepWebOrders();
    assert.equal(second.length, 0);
    assert.equal(calls.delivery.length, 1, "no duplicate email on resume");
  });

  it("describeOrderForStatus shapes the success-page payload", async () => {
    await seedOrder(db, { status: "rendering" });
    const { deps } = makeDeps();
    const orch = createWebOrderOrchestrator({ db, ...deps });
    const order = {
      status: "rendering",
      track_id: "trk_1",
      share_token_id: null,
    };
    const shaped = await orch.describeOrderForStatus(order);
    assert.equal(shaped.status, "rendering");
    assert.equal(shaped.recipient_name, "Sarah");
    assert.match(shaped.progress_copy, /Finishing/);
  });
});
