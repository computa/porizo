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
         price_key, amount_cents, currency, email, status, render_attempts, payment_intent_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'trk_1', 'trk_1_v1', 'gift_song', 1999, 'usd', ?, ?, ?, 'pi_1', ?, ?)`,
    )
    .run(
      orderId,
      `cs_${orderId}`,
      userId,
      email,
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
    getTrackMeta: async () => ({ recipientName: "Sarah" }),
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
