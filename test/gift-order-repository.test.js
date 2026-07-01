process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");

const {
  createGiftOrderRepository,
} = require("../src/database/gift-order-repository");
const { createSqliteAdapter } = require("../src/database/sqlite");

let db;
let repository;

function createSchema(database) {
  database.exec(`
    CREATE TABLE gift_orders (
      id TEXT PRIMARY KEY,
      sender_user_id TEXT NOT NULL,
      content_type TEXT,
      content_id TEXT,
      status TEXT NOT NULL,
      dispatch_status TEXT NOT NULL,
      delivery_mode TEXT,
      send_at TEXT NOT NULL,
      sender_timezone TEXT,
      recipient_name TEXT,
      sender_display_name TEXT,
      channels_json TEXT,
      recipient_phone TEXT,
      recipient_email TEXT,
      message TEXT,
      share_token_id TEXT,
      share_url TEXT,
      claim_pin TEXT,
      claim_policy TEXT,
      expires_in_days INTEGER,
      dispatch_attempts INTEGER,
      last_dispatch_error TEXT,
      dispatched_at TEXT,
      token_transaction_id TEXT,
      refund_transaction_id TEXT,
      version_num INTEGER,
      content_snapshot_json TEXT,
      next_retry_at TEXT,
      dispatch_started_at TEXT,
      cancelled_at TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function insertGift({
  id,
  userId = "gift_order_user",
  status = "scheduled",
  dispatchStatus = "pending",
  sendAt = "2026-06-28T10:00:00.000Z",
  createdAt = "2026-06-28T09:00:00.000Z",
} = {}) {
  await db
    .prepare(
      `INSERT INTO gift_orders (
        id,
        sender_user_id,
        status,
        dispatch_status,
        send_at,
        sender_timezone,
        recipient_name,
        channels_json,
        recipient_phone,
        recipient_email,
        message,
        refund_transaction_id,
        next_retry_at,
        dispatch_started_at,
        cancelled_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      status,
      dispatchStatus,
      sendAt,
      "UTC",
      "Ada",
      JSON.stringify(["email"]),
      null,
      "ada@example.com",
      "hello",
      null,
      sendAt,
      null,
      null,
      createdAt,
      createdAt,
    );
}

describe("GiftOrderRepository", () => {
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    createSchema(db);
    repository = createGiftOrderRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("finds and lists gift orders for one sender with optional status", async () => {
    await insertGift({
      id: "gift_old",
      createdAt: "2026-06-28T08:00:00.000Z",
    });
    await insertGift({
      id: "gift_new",
      status: "cancelled",
      dispatchStatus: "cancelled",
      createdAt: "2026-06-28T09:30:00.000Z",
    });
    await insertGift({
      id: "gift_other_user",
      userId: "other_user",
      createdAt: "2026-06-28T10:00:00.000Z",
    });

    const found = await repository.findById("gift_new");
    assert.equal(found.sender_user_id, "gift_order_user");

    const allRows = await repository.listForUser({
      userId: "gift_order_user",
      limit: 10,
      offset: 0,
    });
    assert.deepEqual(
      allRows.map((row) => row.id),
      ["gift_new", "gift_old"],
    );

    const cancelledRows = await repository.listForUser({
      userId: "gift_order_user",
      status: "cancelled",
      limit: 10,
      offset: 0,
    });
    assert.deepEqual(
      cancelledRows.map((row) => row.id),
      ["gift_new"],
    );
  });

  test("marks cancellable gifts cancelled with compare-and-set status guard", async () => {
    await insertGift({ id: "gift_cancel" });
    await insertGift({ id: "gift_dispatching", status: "dispatching" });

    const cancelled = await repository.markCancelled({
      giftId: "gift_cancel",
      refundTransactionId: "refund_1",
      timestamp: "2026-06-28T10:15:00.000Z",
    });
    assert.equal(cancelled.changes, 1);

    const updated = await repository.findById("gift_cancel");
    assert.equal(updated.status, "cancelled");
    assert.equal(updated.dispatch_status, "cancelled");
    assert.equal(updated.refund_transaction_id, "refund_1");
    assert.equal(updated.next_retry_at, null);

    const blocked = await repository.markCancelled({
      giftId: "gift_dispatching",
      refundTransactionId: "refund_2",
      timestamp: "2026-06-28T10:15:00.000Z",
    });
    assert.equal(blocked.changes, 0);
  });

  test("marks retryable gifts for dispatch retry with status guard", async () => {
    await insertGift({
      id: "gift_failed",
      status: "failed",
      dispatchStatus: "failed",
    });
    await insertGift({
      id: "gift_dispatched",
      status: "dispatched",
      dispatchStatus: "sent",
    });

    const retried = await repository.markRetrying({
      giftId: "gift_failed",
      retryAt: "2026-06-28T10:20:00.000Z",
    });
    assert.equal(retried.changes, 1);

    const updated = await repository.findById("gift_failed");
    assert.equal(updated.status, "dispatch_retry");
    assert.equal(updated.dispatch_status, "retrying");
    assert.equal(updated.next_retry_at, "2026-06-28T10:20:00.000Z");

    const blocked = await repository.markRetrying({
      giftId: "gift_dispatched",
      retryAt: "2026-06-28T10:20:00.000Z",
    });
    assert.equal(blocked.changes, 0);
  });

  test("updates schedule fields and stores normalized channel JSON", async () => {
    await insertGift({ id: "gift_reschedule" });

    await repository.updateSchedule({
      giftId: "gift_reschedule",
      sendAt: "2026-06-29T11:00:00.000Z",
      senderTimezone: "Australia/Perth",
      recipientName: "Grace",
      channels: ["sms", "email"],
      recipientPhone: "+15551234567",
      recipientEmail: "grace@example.com",
      message: "updated",
      updatedAt: "2026-06-28T10:25:00.000Z",
    });

    const updated = await repository.findById("gift_reschedule");
    assert.equal(updated.send_at, "2026-06-29T11:00:00.000Z");
    assert.equal(updated.next_retry_at, "2026-06-29T11:00:00.000Z");
    assert.equal(updated.sender_timezone, "Australia/Perth");
    assert.equal(updated.recipient_name, "Grace");
    assert.deepEqual(JSON.parse(updated.channels_json), ["sms", "email"]);
    assert.equal(updated.recipient_phone, "+15551234567");
    assert.equal(updated.recipient_email, "grace@example.com");
    assert.equal(updated.message, "updated");
  });

  test("inserts scheduled gifts and finds idempotent rows inside caller transaction", async () => {
    await db.transaction(async (query) => {
      await repository.insertScheduled({
        id: "gift_inserted",
        senderUserId: "gift_order_user",
        contentType: "song",
        contentId: "track_1",
        deliveryMode: "scheduled",
        sendAt: "2026-06-30T12:00:00.000Z",
        senderTimezone: "UTC",
        recipientName: "Ada",
        senderDisplayName: "Ambrose",
        channels: ["email"],
        recipientPhone: null,
        recipientEmail: "ada@example.com",
        message: "message",
        shareTokenId: "share_1",
        shareUrl: "https://porizo.co/g/share_1",
        claimPin: "123456",
        claimPolicy: "app_only",
        expiresInDays: 30,
        tokenTransactionId: "gwtx_1",
        versionNum: 2,
        contentSnapshot: { title: "Song" },
        idempotencyKey: "idem_1",
        timestamp: "2026-06-28T10:30:00.000Z",
        query,
      });

      const existing = await repository.findBySenderAndIdempotencyKey({
        userId: "gift_order_user",
        idempotencyKey: "idem_1",
        query,
      });
      assert.equal(existing.id, "gift_inserted");
    });

    const inserted = await repository.findById("gift_inserted");
    assert.equal(inserted.status, "scheduled");
    assert.equal(inserted.dispatch_status, "pending");
    assert.equal(inserted.share_token_id, "share_1");
    assert.deepEqual(JSON.parse(inserted.channels_json), ["email"]);
    assert.deepEqual(JSON.parse(inserted.content_snapshot_json), {
      title: "Song",
    });
  });
});
