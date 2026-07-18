process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createGiftDispatchRepository,
} = require("../src/database/gift-dispatch-repository");

const USER_ID = "gift_dispatch_repo_user";
const NOW = "2026-06-27T10:00:00.000Z";

let db;
let repository;

async function insertGiftOrder({
  id,
  status = "scheduled",
  dispatchStatus = "pending",
  sendAt = "2026-06-27T10:00:00.000Z",
  nextRetryAt = null,
  dispatchStartedAt = null,
  overdueDetectedAt = null,
  lastDispatchError = null,
  createdAt = "2026-06-27T09:00:00.000Z",
} = {}) {
  await db
    .prepare(
      `INSERT INTO gift_orders (
        id,
        sender_user_id,
        content_type,
        content_id,
        status,
        dispatch_status,
        delivery_mode,
        send_at,
        sender_timezone,
        channels_json,
        recipient_email,
        claim_policy,
        expires_in_days,
        dispatch_attempts,
        next_retry_at,
        dispatch_started_at,
        overdue_detected_at,
        last_dispatch_error,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      USER_ID,
      "song",
      `${id}_track`,
      status,
      dispatchStatus,
      "scheduled",
      sendAt,
      "UTC",
      JSON.stringify(["email"]),
      `${id}@example.com`,
      "app_only",
      30,
      0,
      nextRetryAt,
      dispatchStartedAt,
      overdueDetectedAt,
      lastDispatchError,
      createdAt,
      createdAt,
    );
}

async function insertOutbox({
  id,
  giftOrderId,
  channel = "email",
  recipient = null,
  status = "pending",
  lockedAt = null,
  sendAfter = "2026-06-27T09:00:00.000Z",
  nextRetryAt = null,
  lastError = null,
} = {}) {
  await db
    .prepare(
      `INSERT INTO gift_delivery_outbox (
        id,
        gift_order_id,
        channel,
        recipient,
        status,
        attempt_count,
        send_after,
        next_retry_at,
        locked_at,
        last_error,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      giftOrderId,
      channel,
      recipient || (channel === "sms" ? "+15551234567" : `${giftOrderId}@example.com`),
      status,
      0,
      sendAfter,
      nextRetryAt,
      lockedAt,
      lastError,
      JSON.stringify({ giftOrderId }),
      sendAfter,
      sendAfter,
    );
}

describe("GiftDispatchRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createGiftDispatchRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("lists and recovers stale dispatching gifts", async () => {
    await insertGiftOrder({
      id: "gift_stale",
      status: "dispatching",
      dispatchStatus: "pending",
      dispatchStartedAt: "2026-06-27T09:00:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_recent",
      status: "dispatching",
      dispatchStatus: "pending",
      dispatchStartedAt: "2026-06-27T09:59:00.000Z",
    });

    const stale = await repository.listStaleDispatching({
      staleCutoff: "2026-06-27T09:30:00.000Z",
    });
    assert.deepEqual(stale.map((row) => row.id), ["gift_stale"]);

    await repository.recoverStaleDispatching({
      staleCutoff: "2026-06-27T09:30:00.000Z",
      now: NOW,
    });

    const recovered = await db
      .prepare(
        "SELECT status, dispatch_status, dispatch_started_at, next_retry_at, last_dispatch_error FROM gift_orders WHERE id = ?",
      )
      .get("gift_stale");
    assert.deepEqual(recovered, {
      status: "dispatch_retry",
      dispatch_status: "error",
      dispatch_started_at: null,
      next_retry_at: NOW,
      last_dispatch_error: "stale_dispatch_recovered",
    });

    const recent = await db
      .prepare("SELECT status, dispatch_started_at FROM gift_orders WHERE id = ?")
      .get("gift_recent");
    assert.equal(recent.status, "dispatching");
    assert.equal(recent.dispatch_started_at, "2026-06-27T09:59:00.000Z");
  });

  test("lists and recovers stale sending outbox rows", async () => {
    await insertGiftOrder({ id: "gift_outbox" });
    await insertGiftOrder({ id: "gift_outbox_recent" });
    await insertOutbox({
      id: "outbox_stale_email",
      giftOrderId: "gift_outbox",
      status: "sending",
      lockedAt: "2026-06-27T09:00:00.000Z",
    });
    await insertOutbox({
      id: "outbox_stale_sms",
      giftOrderId: "gift_outbox",
      channel: "sms",
      status: "sending",
      lockedAt: "2026-06-27T09:00:00.000Z",
    });
    await insertOutbox({
      id: "outbox_recent",
      giftOrderId: "gift_outbox_recent",
      status: "sending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });

    const stale = await repository.listStaleSending({
      staleCutoff: "2026-06-27T09:30:00.000Z",
    });
    assert.deepEqual(stale, [
      {
        id: "outbox_stale_email",
        gift_order_id: "gift_outbox",
        channel: "email",
      },
      {
        id: "outbox_stale_sms",
        gift_order_id: "gift_outbox",
        channel: "sms",
      },
    ]);

    await repository.recoverStaleSending({
      staleCutoff: "2026-06-27T09:30:00.000Z",
      now: NOW,
    });

    const recovered = await db
      .prepare(
        "SELECT status, last_error, next_retry_at, locked_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_stale_email");
    assert.deepEqual(recovered, {
      status: "failed",
      last_error: "stale_channel_send_recovered",
      next_retry_at: NOW,
      locked_at: null,
    });

    const uncertainSms = await db
      .prepare(
        "SELECT status, last_error, next_retry_at, locked_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_stale_sms");
    assert.deepEqual(uncertainSms, {
      status: "uncertain",
      last_error: "stale_channel_send_recovered",
      next_retry_at: null,
      locked_at: null,
    });
    assert.equal(
      await repository.hasSentDelivery({ giftOrderId: "gift_outbox" }),
      true,
    );

    const recent = await db
      .prepare("SELECT status, locked_at FROM gift_delivery_outbox WHERE id = ?")
      .get("outbox_recent");
    assert.equal(recent.status, "sending");
    assert.equal(recent.locked_at, "2026-06-27T09:59:00.000Z");
  });

  test("lists overdue undelivered gifts and preserves first overdue timestamp", async () => {
    await insertGiftOrder({
      id: "gift_overdue",
      sendAt: "2026-06-27T09:00:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_already_sent",
      sendAt: "2026-06-27T09:00:00.000Z",
    });
    await insertOutbox({
      id: "outbox_sent",
      giftOrderId: "gift_already_sent",
      status: "sent",
    });

    const overdue = await repository.listOverdueUndelivered({
      overdueCutoff: "2026-06-27T09:30:00.000Z",
    });
    assert.deepEqual(overdue.map((row) => row.id), ["gift_overdue"]);

    await repository.markGiftOverdue({ giftOrderId: "gift_overdue", now: NOW });
    await repository.markGiftOverdue({
      giftOrderId: "gift_overdue",
      now: "2026-06-27T10:05:00.000Z",
    });

    const updated = await db
      .prepare("SELECT overdue_detected_at, updated_at FROM gift_orders WHERE id = ?")
      .get("gift_overdue");
    assert.equal(updated.overdue_detected_at, NOW);
    assert.equal(updated.updated_at, "2026-06-27T10:05:00.000Z");
  });

  test("lists due gifts ordered by send_at with limit", async () => {
    await insertGiftOrder({
      id: "gift_late",
      sendAt: "2026-06-27T09:30:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_early",
      status: "dispatch_retry",
      dispatchStatus: "error",
      sendAt: "2026-06-27T09:00:00.000Z",
      nextRetryAt: "2026-06-27T09:45:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_future",
      sendAt: "2026-06-27T10:30:00.000Z",
    });
    await insertGiftOrder({
      id: "gift_cancelled",
      status: "cancelled",
      dispatchStatus: "cancelled",
      sendAt: "2026-06-27T09:10:00.000Z",
    });

    const due = await repository.listDueGifts({
      now: NOW,
      batchSize: 2,
    });

    assert.deepEqual(due.map((row) => row.id), ["gift_early", "gift_late"]);
  });

  test("creates outbox rows and detects existing rows through transaction query", async () => {
    await insertGiftOrder({ id: "gift_create_outbox" });

    await db.transaction(async (query) => {
      assert.equal(
        await repository.hasOutboxRows({
          giftOrderId: "gift_create_outbox",
          query,
        }),
        false,
      );

      await repository.createOutboxRows({
        giftOrderId: "gift_create_outbox",
        channels: ["sms", "email"],
        recipientPhone: "+15551234567",
        recipientEmail: "recipient@example.com",
        sendAtIso: NOW,
        baselineAttemptCount: 2,
        timestamp: NOW,
        query,
      });

      assert.equal(
        await repository.hasOutboxRows({
          giftOrderId: "gift_create_outbox",
          query,
        }),
        true,
      );

      const integrityRows = await repository.listFinalizeIntegrityRows({
        giftOrderId: "gift_create_outbox",
        query,
      });
      assert.deepEqual(
        integrityRows.map((row) => row.channel).sort(),
        ["email", "sms"],
      );
    });

    const rows = await db
      .prepare(
        "SELECT channel, recipient, status, attempt_count, provider_name, first_queued_at FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY channel",
      )
      .all("gift_create_outbox");

    assert.deepEqual(
      rows.map((row) => ({
        channel: row.channel,
        recipient: row.recipient,
        status: row.status,
        attempt_count: Number(row.attempt_count),
        provider_name: row.provider_name,
        first_queued_at: row.first_queued_at,
      })),
      [
        {
          channel: "email",
          recipient: "recipient@example.com",
          status: "pending",
          attempt_count: 2,
          provider_name: "resend",
          first_queued_at: NOW,
        },
        {
          channel: "sms",
          recipient: "+15551234567",
          status: "pending",
          attempt_count: 2,
          provider_name: "twilio",
          first_queued_at: NOW,
        },
      ],
    );
  });

  test("records dispatch attempts and marks delivery sent or failed", async () => {
    await insertGiftOrder({ id: "gift_delivery_state" });
    await insertOutbox({
      id: "outbox_sent_state",
      giftOrderId: "gift_delivery_state",
      status: "sending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });
    await insertOutbox({
      id: "outbox_failed_state",
      giftOrderId: "gift_delivery_state",
      channel: "sms",
      status: "sending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });

    await repository.recordDispatchAttempt({
      giftId: "gift_delivery_state",
      channel: "email",
      status: "success",
      providerMessageId: "provider_1",
      payload: { simulated: true },
      createdAt: NOW,
    });
    await repository.markDeliverySent({
      deliveryId: "outbox_sent_state",
      providerMessageId: "provider_1",
      payloadMeta: { simulated: true },
      sentAt: NOW,
    });
    await repository.markDeliveryFailed({
      deliveryId: "outbox_failed_state",
      attemptCount: 3,
      errorMessage: "x".repeat(600),
      nextRetryAt: "2026-06-27T10:15:00.000Z",
      failedAt: NOW,
    });

    const attempt = await db
      .prepare(
        "SELECT status, provider_message_id, payload_json FROM gift_dispatch_attempts WHERE gift_order_id = ?",
      )
      .get("gift_delivery_state");
    assert.equal(attempt.status, "success");
    assert.equal(attempt.provider_message_id, "provider_1");
    assert.deepEqual(JSON.parse(attempt.payload_json), { simulated: true });

    const sent = await db
      .prepare(
        "SELECT status, attempt_count, provider_message_id, receipt_status, locked_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_sent_state");
    assert.deepEqual(sent, {
      status: "sent",
      attempt_count: 1,
      provider_message_id: "provider_1",
      receipt_status: "accepted",
      locked_at: null,
    });

    const failed = await db
      .prepare(
        "SELECT status, attempt_count, length(last_error) as error_len, next_retry_at, locked_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_failed_state");
    assert.deepEqual(failed, {
      status: "failed",
      attempt_count: 3,
      error_len: 500,
      next_retry_at: "2026-06-27T10:15:00.000Z",
      locked_at: null,
    });
  });

  test("finds delivery receipts by provider id and updates receipt state", async () => {
    await insertGiftOrder({ id: "gift_receipt_lookup" });
    await insertOutbox({
      id: "outbox_receipt_lookup",
      giftOrderId: "gift_receipt_lookup",
      status: "sent",
    });
    await db
      .prepare(
        "UPDATE gift_delivery_outbox SET provider_message_id = ?, receipt_status = ? WHERE id = ?",
      )
      .run("provider_receipt_1", "accepted", "outbox_receipt_lookup");

    const delivery = await repository.findDeliveryByProviderMessageId(
      "provider_receipt_1",
    );
    assert.equal(delivery.id, "outbox_receipt_lookup");
    assert.equal(delivery.gift_id, "gift_receipt_lookup");
    assert.equal(delivery.gift_status, "scheduled");

    await repository.updateDeliveryReceipt({
      deliveryId: "outbox_receipt_lookup",
      receiptStatus: "delivered",
      receiptEventAt: NOW,
      receiptPayload: { event: "delivered" },
      updatedAt: NOW,
    });

    const updated = await db
      .prepare(
        "SELECT receipt_status, receipt_event_at, receipt_payload_json FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_receipt_lookup");
    assert.equal(updated.receipt_status, "delivered");
    assert.equal(updated.receipt_event_at, NOW);
    assert.deepEqual(JSON.parse(updated.receipt_payload_json), {
      event: "delivered",
    });
  });

  test("maps every negative provider receipt to a failed non-retryable outbox state", async () => {
    for (const receiptStatus of [
      "bounced",
      "complained",
      "failed",
      "undelivered",
      "canceled",
      "cancelled",
    ]) {
      const giftOrderId = `gift_negative_${receiptStatus}`;
      const deliveryId = `outbox_negative_${receiptStatus}`;
      await insertGiftOrder({ id: giftOrderId });
      await insertOutbox({
        id: deliveryId,
        giftOrderId,
        channel: receiptStatus === "undelivered" ? "sms" : "email",
        status: "sent",
        nextRetryAt: "2026-06-27T10:15:00.000Z",
      });

      await repository.updateDeliveryReceipt({
        deliveryId,
        receiptStatus,
        receiptEventAt: NOW,
        receiptPayload: { event: receiptStatus },
        updatedAt: NOW,
      });

      const updated = await db
        .prepare(
          "SELECT status, receipt_status, last_error, next_retry_at FROM gift_delivery_outbox WHERE id = ?",
        )
        .get(deliveryId);
      assert.deepEqual(updated, {
        status: "failed",
        receipt_status: receiptStatus,
        last_error: `provider_receipt_${receiptStatus}`,
        next_retry_at: null,
      });
    }
  });

  test("restores sent when a stronger delivered receipt follows a failure", async () => {
    await insertGiftOrder({ id: "gift_receipt_recovered" });
    await insertOutbox({
      id: "outbox_receipt_recovered",
      giftOrderId: "gift_receipt_recovered",
      status: "sent",
    });

    await repository.updateDeliveryReceipt({
      deliveryId: "outbox_receipt_recovered",
      receiptStatus: "failed",
      receiptEventAt: "2026-06-27T09:59:00.000Z",
      receiptPayload: { event: "failed" },
      updatedAt: "2026-06-27T09:59:00.000Z",
    });
    await repository.updateDeliveryReceipt({
      deliveryId: "outbox_receipt_recovered",
      receiptStatus: "delivered",
      receiptEventAt: NOW,
      receiptPayload: { event: "delivered" },
      updatedAt: NOW,
    });

    const updated = await db
      .prepare(
        "SELECT status, receipt_status, last_error, next_retry_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_receipt_recovered");
    assert.deepEqual(updated, {
      status: "sent",
      receipt_status: "delivered",
      last_error: null,
      next_retry_at: null,
    });
  });

  test("recovers sending rows for one gift without touching other gifts", async () => {
    await insertGiftOrder({ id: "gift_recover_one" });
    await insertGiftOrder({ id: "gift_recover_other" });
    await insertOutbox({
      id: "outbox_recover_one",
      giftOrderId: "gift_recover_one",
      status: "sending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });
    await insertOutbox({
      id: "outbox_recover_sms",
      giftOrderId: "gift_recover_one",
      channel: "sms",
      status: "sending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });
    await insertOutbox({
      id: "outbox_recover_other",
      giftOrderId: "gift_recover_other",
      status: "sending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });

    await repository.recoverSendingRowsForGift({
      giftOrderId: "gift_recover_one",
      now: NOW,
    });

    const recovered = await db
      .prepare(
        "SELECT status, next_retry_at, locked_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_recover_one");
    assert.deepEqual(recovered, {
      status: "failed",
      next_retry_at: NOW,
      locked_at: null,
    });

    const recoveredSms = await db
      .prepare(
        "SELECT status, next_retry_at, locked_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_recover_sms");
    assert.deepEqual(recoveredSms, {
      status: "uncertain",
      next_retry_at: null,
      locked_at: null,
    });

    const untouched = await db
      .prepare("SELECT status, locked_at FROM gift_delivery_outbox WHERE id = ?")
      .get("outbox_recover_other");
    assert.equal(untouched.status, "sending");
    assert.equal(untouched.locked_at, "2026-06-27T09:59:00.000Z");
  });

  test("manages route-owned outbox states for cancel retry and reschedule", async () => {
    await insertGiftOrder({ id: "gift_route_outbox" });
    await insertOutbox({
      id: "outbox_route_pending",
      giftOrderId: "gift_route_outbox",
      channel: "email",
      status: "pending",
    });
    await insertOutbox({
      id: "outbox_route_sent",
      giftOrderId: "gift_route_outbox",
      channel: "sms",
      status: "sent",
    });

    assert.equal(
      await repository.hasSentDelivery({ giftOrderId: "gift_route_outbox" }),
      true,
    );

    await repository.cancelUnsentRows({
      giftOrderId: "gift_route_outbox",
      updatedAt: NOW,
    });

    const cancelled = await db
      .prepare("SELECT status, next_retry_at, locked_at FROM gift_delivery_outbox WHERE id = ?")
      .get("outbox_route_pending");
    assert.deepEqual(cancelled, {
      status: "cancelled",
      next_retry_at: null,
      locked_at: null,
    });

    const sent = await db
      .prepare("SELECT status FROM gift_delivery_outbox WHERE id = ?")
      .get("outbox_route_sent");
    assert.equal(sent.status, "sent");

    await insertGiftOrder({ id: "gift_route_retry" });
    await insertOutbox({
      id: "outbox_route_failed",
      giftOrderId: "gift_route_retry",
      channel: "email",
      status: "failed",
      lastError: "provider_error",
    });
    await insertOutbox({
      id: "outbox_route_retry_pending",
      giftOrderId: "gift_route_retry",
      channel: "sms",
      status: "pending",
      lockedAt: "2026-06-27T09:59:00.000Z",
    });

    await repository.resetRetryableRows({
      giftOrderId: "gift_route_retry",
      nextRetryAt: NOW,
      updatedAt: NOW,
    });

    const retryRows = await db
      .prepare(
        "SELECT id, status, next_retry_at, locked_at, last_error FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY id",
      )
      .all("gift_route_retry");
    assert.deepEqual(
      retryRows.map((row) => ({
        id: row.id,
        status: row.status,
        next_retry_at: row.next_retry_at,
        locked_at: row.locked_at,
        last_error: row.last_error,
      })),
      [
        {
          id: "outbox_route_failed",
          status: "pending",
          next_retry_at: NOW,
          locked_at: null,
          last_error: "provider_error",
        },
        {
          id: "outbox_route_retry_pending",
          status: "pending",
          next_retry_at: NOW,
          locked_at: null,
          last_error: null,
        },
      ],
    );

    await repository.deleteUnsentRows({ giftOrderId: "gift_route_retry" });
    const remaining = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM gift_delivery_outbox WHERE gift_order_id = ?",
      )
      .get("gift_route_retry");
    assert.equal(Number(remaining.total), 0);
  });

  test("locks dispatchable gifts and due delivery rows only once", async () => {
    await insertGiftOrder({ id: "gift_lock_dispatch" });
    await insertGiftOrder({
      id: "gift_lock_not_dispatchable",
      status: "dispatched",
      dispatchStatus: "sent",
    });

    const giftLock = await repository.lockGiftForDispatch({
      giftOrderId: "gift_lock_dispatch",
      dispatchStart: NOW,
    });
    assert.equal(giftLock.changes, 1);

    const lockedGift = await repository.findGiftOrder({
      giftOrderId: "gift_lock_dispatch",
    });
    assert.equal(lockedGift.status, "dispatching");
    assert.equal(lockedGift.dispatch_status, "pending");
    assert.equal(lockedGift.dispatch_started_at, NOW);
    assert.equal(lockedGift.first_dispatch_started_at, NOW);

    const repeatedGiftLock = await repository.lockGiftForDispatch({
      giftOrderId: "gift_lock_dispatch",
      dispatchStart: "2026-06-27T10:05:00.000Z",
    });
    assert.equal(repeatedGiftLock.changes, 0);

    const notDispatchableLock = await repository.lockGiftForDispatch({
      giftOrderId: "gift_lock_not_dispatchable",
      dispatchStart: NOW,
    });
    assert.equal(notDispatchableLock.changes, 0);

    await insertOutbox({
      id: "outbox_due_pending",
      giftOrderId: "gift_lock_dispatch",
      status: "pending",
      sendAfter: "2026-06-27T09:00:00.000Z",
    });
    await insertOutbox({
      id: "outbox_due_failed",
      giftOrderId: "gift_lock_dispatch",
      channel: "sms",
      status: "failed",
      sendAfter: "2026-06-27T09:05:00.000Z",
      nextRetryAt: "2026-06-27T09:55:00.000Z",
    });
    const dueRows = await repository.listDueDeliveryRowsForGift({
      giftOrderId: "gift_lock_dispatch",
      now: NOW,
    });
    assert.deepEqual(
      dueRows.map((row) => row.id),
      ["outbox_due_pending", "outbox_due_failed"],
    );

    const deliveryLock = await repository.lockDeliveryForSending({
      deliveryId: "outbox_due_pending",
      lockedAt: NOW,
    });
    assert.equal(deliveryLock.changes, 1);

    const lockedDelivery = await db
      .prepare(
        "SELECT status, locked_at, first_attempt_started_at FROM gift_delivery_outbox WHERE id = ?",
      )
      .get("outbox_due_pending");
    assert.deepEqual(lockedDelivery, {
      status: "sending",
      locked_at: NOW,
      first_attempt_started_at: NOW,
    });

    const repeatedDeliveryLock = await repository.lockDeliveryForSending({
      deliveryId: "outbox_due_pending",
      lockedAt: "2026-06-27T10:05:00.000Z",
    });
    assert.equal(repeatedDeliveryLock.changes, 0);
  });

  test("updates aggregate observability while preserving existing first dispatch timestamp", async () => {
    await insertGiftOrder({
      id: "gift_observability",
      overdueDetectedAt: "2026-06-27T09:30:00.000Z",
    });
    await db
      .prepare(
        "UPDATE gift_orders SET first_dispatch_started_at = ? WHERE id = ?",
      )
      .run("2026-06-27T09:40:00.000Z", "gift_observability");
    await insertOutbox({
      id: "outbox_observability",
      giftOrderId: "gift_observability",
      status: "sent",
    });

    const rows = await repository.listOutboxRowsForGift({
      giftOrderId: "gift_observability",
    });
    assert.deepEqual(rows.map((row) => row.id), ["outbox_observability"]);

    await repository.updateGiftAggregateObservability({
      giftOrderId: "gift_observability",
      firstAttemptStartedAt: "2026-06-27T09:45:00.000Z",
      lastDispatchCompletedAt: "2026-06-27T10:00:00.000Z",
      lastSuccessfulDeliveryAt: "2026-06-27T10:01:00.000Z",
      deliveryLagMs: 60000,
      overdueDetectedAt: null,
      updatedAt: NOW,
    });

    const updated = await repository.findGiftOrder({
      giftOrderId: "gift_observability",
    });
    assert.equal(updated.first_dispatch_started_at, "2026-06-27T09:40:00.000Z");
    assert.equal(updated.last_dispatch_completed_at, "2026-06-27T10:00:00.000Z");
    assert.equal(updated.last_successful_delivery_at, "2026-06-27T10:01:00.000Z");
    assert.equal(Number(updated.delivery_lag_ms), 60000);
    assert.equal(updated.overdue_detected_at, null);
    assert.equal(updated.updated_at, NOW);
  });

  test("marks gift dispatch success incomplete states and crash recovery", async () => {
    await insertGiftOrder({
      id: "gift_dispatch_success",
      status: "dispatching",
      dispatchStatus: "pending",
      dispatchStartedAt: "2026-06-27T09:55:00.000Z",
      overdueDetectedAt: "2026-06-27T09:30:00.000Z",
    });

    await repository.markGiftFullyDispatched({
      giftOrderId: "gift_dispatch_success",
      dispatchAttempts: 2,
      dispatchedAt: NOW,
      deliveryLagMs: 120000,
    });

    const success = await repository.findGiftOrder({
      giftOrderId: "gift_dispatch_success",
    });
    assert.equal(success.status, "dispatched");
    assert.equal(success.dispatch_status, "sent");
    assert.equal(Number(success.dispatch_attempts), 2);
    assert.equal(success.last_dispatch_error, null);
    assert.equal(success.next_retry_at, null);
    assert.equal(success.dispatch_started_at, null);
    assert.equal(success.last_dispatch_completed_at, NOW);
    assert.equal(success.last_successful_delivery_at, NOW);
    assert.equal(Number(success.delivery_lag_ms), 120000);
    assert.equal(success.overdue_detected_at, null);
    assert.equal(success.dispatched_at, NOW);

    await insertGiftOrder({
      id: "gift_dispatch_partial",
      status: "dispatching",
      dispatchStatus: "pending",
      dispatchStartedAt: "2026-06-27T09:55:00.000Z",
      overdueDetectedAt: "2026-06-27T09:30:00.000Z",
    });

    await repository.markGiftDispatchIncomplete({
      giftOrderId: "gift_dispatch_partial",
      status: "dispatch_retry",
      dispatchStatus: "partial_retry",
      dispatchAttempts: 3,
      lastDispatchError: "email:provider_error",
      nextRetryAt: "2026-06-27T10:30:00.000Z",
      lastDispatchCompletedAt: NOW,
      hasPartialDelivery: true,
      lastSuccessfulDeliveryAt: "2026-06-27T09:59:00.000Z",
      deliveryLagMs: 240000,
      clearOverdue: true,
      markDispatched: false,
      dispatchedAt: null,
      refundTransactionId: "refund_1",
      updatedAt: NOW,
    });

    const partial = await repository.findGiftOrder({
      giftOrderId: "gift_dispatch_partial",
    });
    assert.equal(partial.status, "dispatch_retry");
    assert.equal(partial.dispatch_status, "partial_retry");
    assert.equal(Number(partial.dispatch_attempts), 3);
    assert.equal(partial.last_dispatch_error, "email:provider_error");
    assert.equal(partial.next_retry_at, "2026-06-27T10:30:00.000Z");
    assert.equal(partial.dispatch_started_at, null);
    assert.equal(partial.last_dispatch_completed_at, NOW);
    assert.equal(partial.last_successful_delivery_at, "2026-06-27T09:59:00.000Z");
    assert.equal(Number(partial.delivery_lag_ms), 240000);
    assert.equal(partial.overdue_detected_at, null);
    assert.equal(partial.dispatched_at, null);
    assert.equal(partial.refund_transaction_id, "refund_1");

    await insertGiftOrder({
      id: "gift_dispatch_crash",
      status: "dispatching",
      dispatchStatus: "pending",
      dispatchStartedAt: "2026-06-27T09:55:00.000Z",
    });

    await repository.recoverGiftDispatchCrash({
      giftOrderId: "gift_dispatch_crash",
      retryAt: "2026-06-27T10:30:00.000Z",
      errorMessage: "x".repeat(600),
      completedAt: NOW,
    });

    const crash = await repository.findGiftOrder({
      giftOrderId: "gift_dispatch_crash",
    });
    assert.equal(crash.status, "dispatch_retry");
    assert.equal(crash.dispatch_status, "error");
    assert.equal(Number(crash.dispatch_attempts), 1);
    assert.equal(crash.next_retry_at, "2026-06-27T10:30:00.000Z");
    assert.equal(crash.last_dispatch_error.length, 500);
    assert.equal(crash.dispatch_started_at, null);
    assert.equal(crash.last_dispatch_completed_at, NOW);
  });
});
