"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-etsy-orders-32-bytes";
process.env.ETSY_SHOP_ID = "shop_123";
process.env.ETSY_LISTING_IDS = "listing_1";

const assert = require("node:assert/strict");
const { beforeEach, afterEach, describe, it } = require("node:test");
const { initDb } = require("../../src/db");
const {
  createGiftWalletRepository,
} = require("../../src/database/gift-wallet-repository");
const {
  createGiftPurchaseReversalService,
} = require("../../src/services/gift-purchase-reversal");
const {
  createEtsyOrderService,
} = require("../../src/services/etsy-order-service");

describe("Etsy order-backed fulfilment", () => {
  let db;
  let wallet;
  let service;
  let revokedBoundOrders;

  beforeEach(async () => {
    db = await initDb();
    wallet = createGiftWalletRepository(db);
    revokedBoundOrders = [];
    service = createEtsyOrderService({
      db,
      giftWalletRepository: wallet,
      giftPurchaseReversalService: createGiftPurchaseReversalService({
        giftWalletRepository: wallet,
      }),
      revokeBoundOrder: async ({ unit }) => {
        revokedBoundOrders.push(unit.web_order_id);
      },
      configuredShopId: "shop_123",
      allowedListingIds: ["listing_1"],
    });
    await db
      .prepare(
        "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, CURRENT_TIMESTAMP, 'low', 'active')",
      )
      .run("etsy_buyer");
  });

  afterEach(async () => {
    await db.close();
  });

  function receipt(overrides = {}) {
    return {
      shop_id: "shop_123",
      receipt_id: "456789",
      buyer_user_id: "etsy_user_1",
      buyer_email: "Buyer@Example.com",
      is_paid: true,
      is_canceled: false,
      status: "paid",
      currency_code: "USD",
      amount_minor: 3998,
      transactions: [
        {
          transaction_id: "transaction_1",
          listing_id: "listing_1",
          quantity: 2,
        },
      ],
      ...overrides,
    };
  }

  it("creates exactly one unit per quantity and is replay-safe", async () => {
    const first = await service.ingestPaidReceipt(receipt());
    const second = await service.ingestPaidReceipt(receipt());

    assert.deepEqual(second.unitIds, first.unitIds);
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM etsy_order_units")
      .get();
    assert.equal(Number(count.count), 2);
    const stored = await db.prepare("SELECT * FROM etsy_orders").get();
    assert.notEqual(stored.buyer_email_encrypted, "buyer@example.com");
    assert.equal(String(stored.buyer_email_lookup_hash).length, 64);
  });

  it("atomically claims every paid unit and grants fungible wallet credits once", async () => {
    await service.ingestPaidReceipt(receipt());
    const first = await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "buyer@example.com",
      userId: "etsy_buyer",
    });
    const retry = await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "BUYER@example.com",
      userId: "etsy_buyer",
    });

    assert.equal(first.unitIds.length, 2);
    assert.equal(retry.unitIds.length, 2);
    assert.equal(await wallet.getBalance("etsy_buyer"), 2);
    const grants = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM gift_wallet_transactions WHERE source = 'etsy'",
      )
      .get();
    assert.equal(Number(grants.count), 2);
  });

  it("does not disclose or claim an order for a different verified email", async () => {
    await service.ingestPaidReceipt(receipt());
    await assert.rejects(
      service.claimByVerifiedEmail({
        receiptId: "456789",
        email: "attacker@example.com",
        userId: "etsy_buyer",
      }),
      (error) => error.code === "ETSY_ORDER_NOT_FOUND",
    );
    assert.equal(await wallet.getBalance("etsy_buyer"), 0);
  });

  it("cancellation reverses claimed grants idempotently", async () => {
    await service.ingestPaidReceipt(receipt());
    await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "buyer@example.com",
      userId: "etsy_buyer",
    });
    const first = await service.cancelReceipt({
      receiptId: "456789",
      providerEventId: "event_cancel_1",
    });
    const retry = await service.cancelReceipt({
      receiptId: "456789",
      providerEventId: "event_cancel_1",
    });

    assert.equal(first.reversed, 2);
    assert.equal(retry.reversed, 0);
    assert.equal(await wallet.getNetBalance("etsy_buyer"), 0);
    const reversals = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM gift_wallet_transactions WHERE type = 'purchase_reversal'",
      )
      .get();
    assert.equal(Number(reversals.count), 2);
  });

  it("rejects the wrong shop, unpaid receipts, and unconfigured listings", async () => {
    await assert.rejects(
      service.ingestPaidReceipt(receipt({ shop_id: "attacker_shop" })),
      (error) => error.code === "ETSY_SHOP_MISMATCH",
    );
    await assert.rejects(
      service.ingestPaidReceipt(receipt({ is_paid: false })),
      (error) => error.code === "ETSY_ORDER_NOT_PAID",
    );
    await assert.rejects(
      service.ingestPaidReceipt({
        ...receipt(),
        transactions: [
          {
            transaction_id: "transaction_2",
            listing_id: "unconfigured",
            quantity: 1,
          },
        ],
      }),
      (error) => error.code === "ETSY_LISTING_NOT_ALLOWED",
    );
  });

  it("durably deduplicates webhook IDs before asynchronous processing", async () => {
    const event = {
      webhookId: "webhook_1",
      eventType: "order.paid",
      shopId: "shop_123",
      receiptId: "456789",
      bodySha256: "a".repeat(64),
    };
    assert.deepEqual(await service.recordWebhook(event), { inserted: true });
    assert.deepEqual(await service.recordWebhook(event), { inserted: false });
    await assert.rejects(
      service.recordWebhook({
        ...event,
        receiptId: "999999",
        bodySha256: "b".repeat(64),
      }),
      (error) => error.code === "ETSY_WEBHOOK_ID_CONFLICT",
    );
  });

  it("holds partial refunds for review without over-reversing fungible credits", async () => {
    await service.ingestPaidReceipt(receipt());
    await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "buyer@example.com",
      userId: "etsy_buyer",
    });

    const result = await service.syncReceipt(
      receipt({
        status: "partially_refunded",
        payment_adjustments: [
          {
            adjustment_id: "adjustment_1",
            status: "SUCCESS",
            payment_adjustment_items: [
              {
                payment_adjustment_item_id: "adjustment_item_1",
                transaction_id: "transaction_1",
                adjustment_amount: { amount: 1999 },
              },
            ],
          },
        ],
      }),
    );

    assert.equal(result.manualReview, true);
    assert.equal(await wallet.getNetBalance("etsy_buyer"), 2);
    const order = await db
      .prepare(
        "SELECT state, refunded_amount_minor FROM etsy_orders WHERE receipt_id = ?",
      )
      .get("456789");
    assert.equal(order.state, "manual_review");
    assert.equal(Number(order.refunded_amount_minor), 1999);
    const adjustment = await db
      .prepare(
        "SELECT transaction_id FROM etsy_payment_adjustments WHERE adjustment_item_id = ?",
      )
      .get("adjustment_item_1");
    assert.equal(adjustment.transaction_id, "transaction_1");
  });

  it("does not advance the reconciliation cursor when the page cap is hit", async () => {
    const cursor = new Date(Date.now() - 60_000).toISOString();
    await db
      .prepare(
        `INSERT INTO etsy_connections
          (shop_id, status, reconciliation_cursor, created_at, updated_at)
         VALUES ('shop_123', 'connected', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(cursor);

    await assert.rejects(
      service.reconcileReceipts(
        {
          listShopReceipts: async () => ({
            results: [receipt({ update_timestamp: Math.floor(Date.now() / 1000) })],
          }),
        },
        { pageSize: 1, maxPages: 1 },
      ),
      (error) => error.code === "ETSY_RECONCILIATION_PAGE_CAP",
    );
    const connection = await db
      .prepare(
        "SELECT reconciliation_cursor, last_error FROM etsy_connections WHERE shop_id = ?",
      )
      .get("shop_123");
    assert.equal(connection.reconciliation_cursor, cursor);
    assert.equal(connection.last_error, "ETSY_RECONCILIATION_PAGE_CAP");
  });

  it("delivers each fulfilment outbox email once and leaves uncertainty terminal", async () => {
    const ingested = await service.ingestPaidReceipt(
      receipt({
        transactions: [
          {
            transaction_id: "transaction_email",
            listing_id: "listing_1",
            quantity: 1,
          },
        ],
      }),
    );
    const order = await db.prepare("SELECT id FROM etsy_orders").get();
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO etsy_fulfilment_outbox
          (id, etsy_order_id, etsy_order_unit_id, action, status,
           attempt_count, locked_at, created_at, updated_at)
         VALUES ('outbox_email_1', ?, ?, 'mp3_ready_email', 'processing', 1,
                 ?, ?, ?)`,
      )
      .run(
        order.id,
        ingested.unitIds[0],
        new Date(Date.now() - 10 * 60_000).toISOString(),
        now,
        now,
      );

    let sends = 0;
    const send = async ({ to, idempotencyKey }) => {
      sends += 1;
      assert.equal(to, "buyer@example.com");
      assert.match(idempotencyKey, /^etsy-mp3-ready-/);
      return { messageId: "message_1" };
    };
    await service.processFulfilmentOutbox({ sendMp3ReadyEmail: send });
    await service.processFulfilmentOutbox({ sendMp3ReadyEmail: send });
    assert.equal(sends, 1);
    const sent = await db
      .prepare(
        "SELECT status, provider_message_id FROM etsy_fulfilment_outbox WHERE id = ?",
      )
      .get("outbox_email_1");
    assert.equal(sent.status, "sent");
    assert.equal(sent.provider_message_id, "message_1");

    await db
      .prepare(
        `UPDATE etsy_fulfilment_outbox
            SET status = 'uncertain', next_attempt_at = NULL, locked_at = NULL
          WHERE id = ?`,
      )
      .run("outbox_email_1");
    await service.processFulfilmentOutbox({ sendMp3ReadyEmail: send });
    assert.equal(sends, 1);
  });

  it("marks a verified MP3 delivered and enqueues its completion email", async () => {
    const ingested = await service.ingestPaidReceipt(
      receipt({
        transactions: [
          {
            transaction_id: "transaction_delivery",
            listing_id: "listing_1",
            quantity: 1,
          },
        ],
      }),
    );
    await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "buyer@example.com",
      userId: "etsy_buyer",
    });
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO tracks
          (id, user_id, status, title, occasion, recipient_name, style,
           created_at, updated_at)
         VALUES ('delivery_track', 'etsy_buyer', 'complete', 'Song', 'custom',
                 'Recipient', 'acoustic', ?, ?)`,
      )
      .run(now, now);
    await db
      .prepare(
        `INSERT INTO track_versions
          (id, track_id, version_num, status, render_type, params_hash,
           lyrics_status, created_at)
         VALUES ('delivery_version', 'delivery_track', 1, 'full_ready', 'full',
                 'delivery-hash', 'approved', ?)`,
      )
      .run(now);
    await db.transaction((query) =>
      service.bindUnitToWebOrder({
        unitId: ingested.unitIds[0],
        userId: "etsy_buyer",
        webOrderId: "delivery_web_order",
        giftReservationId: "delivery_reservation",
        trackId: "delivery_track",
        trackVersionId: "delivery_version",
        query,
      }),
    );
    await db
      .prepare(
        `INSERT INTO track_artifacts
          (id, track_version_id, kind, status, storage_key, sha256,
           byte_length, created_at, updated_at)
         VALUES ('delivery_artifact', 'delivery_version', 'full_mp3', 'ready',
                 'tracks/delivery.mp3', ?, 4096, ?, ?)`,
      )
      .run("d".repeat(64), now, now);

    const delivered = await service.markDeliveredForUnit(ingested.unitIds[0]);
    assert.equal(delivered.delivered, true);
    const outbox = await db
      .prepare(
        `SELECT status FROM etsy_fulfilment_outbox
          WHERE etsy_order_unit_id = ? AND action = 'mp3_ready_email'`,
      )
      .get(ingested.unitIds[0]);
    assert.equal(outbox.status, "pending");
  });

  it("binds one claimed unit to one concrete web order and rejects reuse", async () => {
    await service.ingestPaidReceipt(receipt());
    await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "buyer@example.com",
      userId: "etsy_buyer",
    });
    const context = await service.findActiveForOwner("etsy_buyer");
    assert.ok(context.journey_id);

    await db.transaction((query) =>
      service.bindUnitToWebOrder({
        unitId: context.journey_id,
        userId: "etsy_buyer",
        webOrderId: "worder_1",
        giftReservationId: "reservation_1",
        trackId: "track_1",
        trackVersionId: "version_1",
        query,
      }),
    );
    const bound = await service.findUnitForWebOrder("worder_1");
    assert.equal(bound.state, "reserved");
    assert.equal(bound.track_version_id, "version_1");

    await assert.rejects(
      db.transaction((query) =>
        service.bindUnitToWebOrder({
          unitId: context.journey_id,
          userId: "etsy_buyer",
          webOrderId: "worder_2",
          giftReservationId: "reservation_2",
          trackId: "track_2",
          trackVersionId: "version_2",
          query,
        }),
      ),
      (error) => error.code === "ETSY_JOURNEY_ALREADY_USED",
    );
  });

  it("marks webhook completion and durably retries a failed provider read", async () => {
    const event = {
      webhookId: "webhook_process_1",
      eventType: "order.paid",
      shopId: "shop_123",
      receiptId: "456789",
      bodySha256: "b".repeat(64),
    };
    await service.recordWebhook(event);
    await assert.rejects(
      service.processWebhook("webhook_process_1", {
        getReceipt: async () => {
          throw Object.assign(new Error("temporary"), {
            code: "ETSY_API_FAILED",
          });
        },
      }),
      (error) => error.code === "ETSY_API_FAILED",
    );
    let stored = await db
      .prepare(
        "SELECT status, attempt_count FROM etsy_webhook_events WHERE webhook_id = ?",
      )
      .get("webhook_process_1");
    assert.equal(stored.status, "failed");
    assert.equal(Number(stored.attempt_count), 1);

    await service.processPendingWebhooks({
      getReceipt: async () => receipt(),
    });
    stored = await db
      .prepare(
        "SELECT status, attempt_count FROM etsy_webhook_events WHERE webhook_id = ?",
      )
      .get("webhook_process_1");
    assert.equal(stored.status, "failed");
    assert.equal(Number(stored.attempt_count), 1);

    await db
      .prepare(
        "UPDATE etsy_webhook_events SET next_attempt_at = ? WHERE webhook_id = ?",
      )
      .run(new Date(Date.now() - 1_000).toISOString(), "webhook_process_1");
    await service.processPendingWebhooks({
      getReceipt: async () => receipt(),
    });
    stored = await db
      .prepare(
        "SELECT status, attempt_count FROM etsy_webhook_events WHERE webhook_id = ?",
      )
      .get("webhook_process_1");
    assert.equal(stored.status, "completed");
    assert.equal(Number(stored.attempt_count), 2);
  });

  it("does not resurrect a canceled receipt when a delayed paid event arrives", async () => {
    await service.ingestCanceledReceipt(
      receipt({ status: "canceled", is_paid: true }),
      { providerEventId: "cancel_first" },
    );
    const delayed = await service.ingestPaidReceipt(
      receipt({ status: "paid", is_paid: true }),
    );
    assert.equal(delayed.ignored, true);
    const order = await db.prepare("SELECT state, is_canceled FROM etsy_orders").get();
    assert.equal(order.state, "canceled");
    assert.equal(Boolean(order.is_canceled), true);
    const units = await db
      .prepare("SELECT COUNT(*) AS count FROM etsy_order_units")
      .get();
    assert.equal(Number(units.count), 0);
  });

  it("fulfills configured transactions in a mixed Etsy cart", async () => {
    const result = await service.ingestPaidReceipt(
      receipt({
        status: "paid",
        transactions: [
          {
            transaction_id: "song_transaction",
            listing_id: "listing_1",
            quantity: 1,
          },
          {
            transaction_id: "other_transaction",
            listing_id: "other_listing",
            quantity: 1,
          },
        ],
      }),
    );
    assert.equal(result.unitIds.length, 1);
  });

  it("revokes a generated order before reversing its Etsy grant", async () => {
    await service.ingestPaidReceipt(
      receipt({
        transactions: [
          {
            transaction_id: "transaction_bound",
            listing_id: "listing_1",
            quantity: 1,
          },
        ],
      }),
    );
    await service.claimByVerifiedEmail({
      receiptId: "456789",
      email: "buyer@example.com",
      userId: "etsy_buyer",
    });
    const context = await service.findActiveForOwner("etsy_buyer");
    await db.transaction((query) =>
      service.bindUnitToWebOrder({
        unitId: context.journey_id,
        userId: "etsy_buyer",
        webOrderId: "worder_refunded",
        giftReservationId: "reservation_refunded",
        trackId: "track_refunded",
        trackVersionId: "version_refunded",
        query,
      }),
    );

    await service.cancelReceipt({
      receiptId: "456789",
      providerEventId: "event_refund_bound",
    });
    assert.deepEqual(revokedBoundOrders, ["worder_refunded"]);
    const unit = await db
      .prepare("SELECT state FROM etsy_order_units WHERE web_order_id = ?")
      .get("worder_refunded");
    assert.equal(unit.state, "refunded");
  });
});
