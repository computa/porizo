"use strict";

const { newUuid } = require("../utils/ids");
const { toJson } = require("../utils/common");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createGiftDispatchRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function createOutboxRows({
    giftOrderId,
    channels,
    recipientPhone,
    recipientEmail,
    sendAtIso,
    baselineAttemptCount = 0,
    nextRetryAt = null,
    timestamp,
    query: externalQuery = null,
  }) {
    const query = externalQuery || db.query.bind(db);

    for (const channel of channels) {
      const recipient = channel === "sms" ? recipientPhone : recipientEmail;
      if (!recipient) continue;
      const providerName = channel === "sms" ? "twilio" : "resend";

      await query(
        `INSERT INTO gift_delivery_outbox (
          id, gift_order_id, channel, recipient, status, attempt_count,
          provider_message_id, last_error, send_after, next_retry_at, last_attempt_at, locked_at,
          payload_json, created_at, updated_at, provider_name, first_queued_at, first_attempt_started_at,
          provider_accepted_at, receipt_status, receipt_event_at, receipt_updated_at, receipt_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newUuid(),
          giftOrderId,
          channel,
          recipient,
          "pending",
          Math.max(0, Number(baselineAttemptCount || 0)),
          null,
          null,
          sendAtIso,
          nextRetryAt || sendAtIso,
          null,
          null,
          toJson({}),
          timestamp,
          timestamp,
          providerName,
          timestamp,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      );
    }
  }

  async function hasOutboxRows({ giftOrderId, query: externalQuery = null }) {
    const query = externalQuery || db.query.bind(db);
    const existingResult = await query(
      "SELECT id FROM gift_delivery_outbox WHERE gift_order_id = ? LIMIT 1",
      [giftOrderId],
    );
    return (existingResult?.rows || []).length > 0;
  }

  async function hasSentDelivery({ giftOrderId, query = null }) {
    const row = await runner(query)
      .prepare(
        `SELECT id FROM gift_delivery_outbox
         WHERE gift_order_id = ? AND status IN ('sent', 'uncertain')
         LIMIT 1`,
      )
      .get(giftOrderId);
    return Boolean(row);
  }

  async function cancelUnsentRows({ giftOrderId, updatedAt, query = null }) {
    return runner(query)
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'cancelled',
             next_retry_at = NULL,
             locked_at = NULL,
             updated_at = ?
         WHERE gift_order_id = ? AND status IN ('pending', 'failed', 'sending')`,
      )
      .run(updatedAt, giftOrderId);
  }

  async function cancelUnsentChannels({
    giftOrderId,
    channels,
    updatedAt,
    query = null,
  }) {
    const normalized = [...new Set(channels || [])].filter((channel) =>
      ["sms", "email"].includes(channel),
    );
    if (!normalized.length) return { changes: 0 };
    const placeholders = normalized.map(() => "?").join(", ");
    return runner(query)
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'cancelled',
             next_retry_at = NULL,
             locked_at = NULL,
             updated_at = ?
         WHERE gift_order_id = ?
           AND channel IN (${placeholders})
           AND status IN ('pending', 'failed')`,
      )
      .run(updatedAt, giftOrderId, ...normalized);
  }

  async function resetRetryableRows({ giftOrderId, nextRetryAt, updatedAt }) {
    return db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'pending',
             next_retry_at = ?,
             locked_at = NULL,
             last_error = CASE WHEN status = 'failed' THEN last_error ELSE NULL END,
             updated_at = ?
         WHERE gift_order_id = ?
           AND status IN ('failed', 'pending')`,
      )
      .run(nextRetryAt, updatedAt, giftOrderId);
  }

  async function deleteUnsentRows({ giftOrderId }) {
    return db
      .prepare(
        "DELETE FROM gift_delivery_outbox WHERE gift_order_id = ? AND status IN ('pending', 'failed', 'cancelled')",
      )
      .run(giftOrderId);
  }

  async function listFinalizeIntegrityRows({ giftOrderId, query = null }) {
    return runner(query)
      .prepare(
        "SELECT id, channel, recipient, status, send_after, next_retry_at FROM gift_delivery_outbox WHERE gift_order_id = ? ORDER BY created_at ASC",
      )
      .all(giftOrderId);
  }

  async function findGiftOrder({ giftOrderId }) {
    return db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(giftOrderId);
  }

  async function lockGiftForDispatch({ giftOrderId, dispatchStart }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = 'dispatching',
             dispatch_status = 'pending',
             dispatch_started_at = ?,
             first_dispatch_started_at = COALESCE(first_dispatch_started_at, ?),
             updated_at = ?
         WHERE id = ? AND status IN ('scheduled', 'dispatch_retry')`,
      )
      .run(dispatchStart, dispatchStart, dispatchStart, giftOrderId);
  }

  async function listDueDeliveryRowsForGift({ giftOrderId, now }) {
    return db
      .prepare(
        `SELECT *
         FROM gift_delivery_outbox
         WHERE gift_order_id = ?
           AND status IN ('pending', 'failed')
           AND COALESCE(next_retry_at, send_after) <= ?
         ORDER BY created_at ASC`,
      )
      .all(giftOrderId, now);
  }

  async function lockDeliveryForSending({ deliveryId, lockedAt }) {
    return db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'sending',
             locked_at = ?,
             first_attempt_started_at = COALESCE(first_attempt_started_at, ?),
             updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')`,
      )
      .run(lockedAt, lockedAt, lockedAt, deliveryId);
  }

  async function listOutboxRowsForGift({ giftOrderId, query = null }) {
    return runner(query)
      .prepare(
        `SELECT *
         FROM gift_delivery_outbox
         WHERE gift_order_id = ?
         ORDER BY created_at ASC`,
      )
      .all(giftOrderId);
  }

  async function updateGiftAggregateObservability({
    giftOrderId,
    firstAttemptStartedAt,
    lastDispatchCompletedAt,
    lastSuccessfulDeliveryAt,
    deliveryLagMs,
    overdueDetectedAt,
    updatedAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_orders
         SET first_dispatch_started_at = COALESCE(first_dispatch_started_at, ?),
             last_dispatch_completed_at = ?,
             last_successful_delivery_at = ?,
             delivery_lag_ms = COALESCE(?, delivery_lag_ms),
             overdue_detected_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        firstAttemptStartedAt,
        lastDispatchCompletedAt,
        lastSuccessfulDeliveryAt,
        deliveryLagMs,
        overdueDetectedAt,
        updatedAt,
        giftOrderId,
      );
  }

  async function markGiftFullyDispatched({
    giftOrderId,
    dispatchAttempts,
    dispatchedAt,
    deliveryLagMs,
  }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = 'dispatched',
             dispatch_status = 'sent',
             dispatch_attempts = ?,
             last_dispatch_error = NULL,
             next_retry_at = NULL,
             dispatch_started_at = NULL,
             last_dispatch_completed_at = ?,
             last_successful_delivery_at = ?,
             delivery_lag_ms = COALESCE(?, delivery_lag_ms),
             overdue_detected_at = NULL,
             dispatched_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        dispatchAttempts,
        dispatchedAt,
        dispatchedAt,
        deliveryLagMs,
        dispatchedAt,
        dispatchedAt,
        giftOrderId,
      );
  }

  async function markGiftDispatchIncomplete({
    giftOrderId,
    status,
    dispatchStatus,
    dispatchAttempts,
    lastDispatchError,
    nextRetryAt,
    lastDispatchCompletedAt,
    hasPartialDelivery,
    lastSuccessfulDeliveryAt,
    deliveryLagMs,
    clearOverdue,
    markDispatched,
    dispatchedAt,
    refundTransactionId,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = ?,
             dispatch_status = ?,
             dispatch_attempts = ?,
             last_dispatch_error = ?,
             next_retry_at = ?,
             dispatch_started_at = NULL,
             last_dispatch_completed_at = ?,
             last_successful_delivery_at = CASE WHEN ? THEN COALESCE(last_successful_delivery_at, ?) ELSE last_successful_delivery_at END,
             delivery_lag_ms = COALESCE(?, delivery_lag_ms),
             overdue_detected_at = CASE WHEN ? THEN NULL ELSE overdue_detected_at END,
             dispatched_at = CASE WHEN ? THEN COALESCE(dispatched_at, ?) ELSE dispatched_at END,
             refund_transaction_id = COALESCE(?, refund_transaction_id),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        dispatchStatus,
        dispatchAttempts,
        lastDispatchError,
        nextRetryAt,
        lastDispatchCompletedAt,
        hasPartialDelivery ? 1 : 0,
        lastSuccessfulDeliveryAt,
        deliveryLagMs,
        clearOverdue ? 1 : 0,
        markDispatched ? 1 : 0,
        dispatchedAt,
        refundTransactionId,
        updatedAt,
        giftOrderId,
      );
  }

  async function recoverGiftDispatchCrash({
    giftOrderId,
    retryAt,
    errorMessage,
    completedAt,
  }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = 'dispatch_retry',
             dispatch_status = 'error',
             dispatch_attempts = dispatch_attempts + 1,
             next_retry_at = ?,
             last_dispatch_error = ?,
             dispatch_started_at = NULL,
             last_dispatch_completed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'dispatching'`,
      )
      .run(
        retryAt,
        String(errorMessage || "").slice(0, 500),
        completedAt,
        completedAt,
        giftOrderId,
      );
  }

  async function recordDispatchAttempt({
    giftId,
    channel,
    status,
    providerMessageId = null,
    errorMessage = null,
    payload = {},
    createdAt,
  }) {
    await db
      .prepare(
        `INSERT INTO gift_dispatch_attempts (
          id, gift_order_id, channel, status, provider_message_id, error_message, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newUuid(),
        giftId,
        channel,
        status,
        providerMessageId,
        errorMessage,
        toJson(payload),
        createdAt,
      );
  }

  async function markDeliverySent({
    deliveryId,
    providerMessageId,
    payloadMeta,
    sentAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'sent',
             attempt_count = attempt_count + 1,
             provider_message_id = ?,
             last_error = NULL,
             next_retry_at = NULL,
             last_attempt_at = ?,
             provider_accepted_at = COALESCE(provider_accepted_at, ?),
             receipt_status = COALESCE(receipt_status, 'accepted'),
             receipt_event_at = COALESCE(receipt_event_at, ?),
             receipt_updated_at = ?,
             receipt_payload_json = ?,
             locked_at = NULL,
             payload_json = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        providerMessageId,
        sentAt,
        sentAt,
        sentAt,
        sentAt,
        toJson(payloadMeta),
        toJson(payloadMeta),
        sentAt,
        deliveryId,
      );
  }

  async function markDeliveryFailed({
    deliveryId,
    attemptCount,
    errorMessage,
    nextRetryAt,
    failedAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = 'failed',
             attempt_count = ?,
             last_error = ?,
             next_retry_at = ?,
             last_attempt_at = ?,
             receipt_updated_at = ?,
             locked_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        attemptCount,
        String(errorMessage || "").slice(0, 500),
        nextRetryAt,
        failedAt,
        failedAt,
        failedAt,
        deliveryId,
      );
  }

  async function findDeliveryByProviderMessageId(providerMessageId) {
    return db
      .prepare(
        `SELECT gdo.*, go.id as gift_id, go.status as gift_status
         FROM gift_delivery_outbox gdo
         JOIN gift_orders go ON go.id = gdo.gift_order_id
         WHERE gdo.provider_message_id = ?
         ORDER BY gdo.updated_at DESC
         LIMIT 1`,
      )
      .get(providerMessageId);
  }

  async function updateDeliveryReceipt({
    deliveryId,
    receiptStatus,
    receiptEventAt,
    receiptPayload,
    updatedAt,
  }) {
    const normalizedReceiptStatus = String(receiptStatus || "").toLowerCase();
    const isTerminalFailure = [
      "bounced",
      "complained",
      "failed",
      "undelivered",
      "canceled",
      "cancelled",
    ].includes(normalizedReceiptStatus);
    const isDelivered = normalizedReceiptStatus === "delivered";
    await db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = CASE
               WHEN ? = 1 THEN 'failed'
               WHEN ? = 1 THEN 'sent'
               ELSE status
             END,
             receipt_status = ?,
             receipt_event_at = ?,
             receipt_updated_at = ?,
             receipt_payload_json = ?,
             last_error = CASE
               WHEN ? = 1 THEN ?
               WHEN ? = 1 THEN NULL
               ELSE last_error
             END,
             next_retry_at = CASE WHEN ? = 1 THEN NULL ELSE next_retry_at END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        isTerminalFailure ? 1 : 0,
        isDelivered ? 1 : 0,
        receiptStatus,
        receiptEventAt,
        updatedAt,
        toJson(receiptPayload),
        isTerminalFailure ? 1 : 0,
        isTerminalFailure ? `provider_receipt_${normalizedReceiptStatus}` : null,
        isDelivered ? 1 : 0,
        isTerminalFailure ? 1 : 0,
        updatedAt,
        deliveryId,
      );
  }

  async function recoverSendingRowsForGift({ giftOrderId, now }) {
    return db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = CASE WHEN channel = 'email' THEN 'failed' ELSE 'uncertain' END,
             last_error = COALESCE(last_error, 'stale_channel_send_recovered'),
             next_retry_at = CASE WHEN channel = 'email' THEN ? ELSE NULL END,
             locked_at = NULL,
             updated_at = ?
         WHERE gift_order_id = ? AND status = 'sending'`,
      )
      .run(now, now, giftOrderId);
  }

  async function listStaleDispatching({ staleCutoff }) {
    return db
      .prepare(
        `SELECT id
         FROM gift_orders
         WHERE status = 'dispatching'
           AND dispatch_started_at IS NOT NULL
           AND dispatch_started_at <= ?`,
      )
      .all(staleCutoff);
  }

  async function recoverStaleDispatching({ staleCutoff, now }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = 'dispatch_retry',
             dispatch_status = 'error',
             dispatch_started_at = NULL,
             next_retry_at = ?,
             last_dispatch_error = COALESCE(last_dispatch_error, 'stale_dispatch_recovered'),
             updated_at = ?
         WHERE status = 'dispatching'
           AND dispatch_started_at IS NOT NULL
           AND dispatch_started_at <= ?`,
      )
      .run(now, now, staleCutoff);
  }

  async function listStaleSending({ staleCutoff }) {
    return db
      .prepare(
        `SELECT id, gift_order_id, channel
         FROM gift_delivery_outbox
         WHERE status = 'sending'
           AND locked_at IS NOT NULL
           AND locked_at <= ?`,
      )
      .all(staleCutoff);
  }

  async function recoverStaleSending({ staleCutoff, now }) {
    return db
      .prepare(
        `UPDATE gift_delivery_outbox
         SET status = CASE WHEN channel = 'email' THEN 'failed' ELSE 'uncertain' END,
             last_error = COALESCE(last_error, 'stale_channel_send_recovered'),
             next_retry_at = CASE WHEN channel = 'email' THEN ? ELSE NULL END,
             locked_at = NULL,
             updated_at = ?
         WHERE status = 'sending'
           AND locked_at IS NOT NULL
           AND locked_at <= ?`,
      )
      .run(now, now, staleCutoff);
  }

  async function listOverdueUndelivered({ overdueCutoff }) {
    return db
      .prepare(
        `SELECT go.id
         FROM gift_orders go
         LEFT JOIN gift_delivery_outbox gdo
           ON gdo.gift_order_id = go.id AND gdo.status = 'sent'
         WHERE go.status IN ('scheduled', 'dispatch_retry')
           AND COALESCE(go.next_retry_at, go.send_at) <= ?
         GROUP BY go.id
         HAVING COUNT(gdo.id) = 0`,
      )
      .all(overdueCutoff);
  }

  async function markGiftOverdue({ giftOrderId, now }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET overdue_detected_at = COALESCE(overdue_detected_at, ?),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, giftOrderId);
  }

  async function listDueGifts({ now, batchSize }) {
    return db
      .prepare(
        `SELECT id
         FROM gift_orders
         WHERE status IN ('scheduled', 'dispatch_retry')
           AND COALESCE(next_retry_at, send_at) <= ?
         ORDER BY send_at ASC
         LIMIT ?`,
      )
      .all(now, batchSize);
  }

  return {
    listStaleDispatching,
    createOutboxRows,
    hasOutboxRows,
    hasSentDelivery,
    cancelUnsentRows,
    cancelUnsentChannels,
    resetRetryableRows,
    deleteUnsentRows,
    listFinalizeIntegrityRows,
    findGiftOrder,
    lockGiftForDispatch,
    listDueDeliveryRowsForGift,
    lockDeliveryForSending,
    listOutboxRowsForGift,
    updateGiftAggregateObservability,
    markGiftFullyDispatched,
    markGiftDispatchIncomplete,
    recoverGiftDispatchCrash,
    recordDispatchAttempt,
    markDeliverySent,
    markDeliveryFailed,
    findDeliveryByProviderMessageId,
    updateDeliveryReceipt,
    recoverSendingRowsForGift,
    recoverStaleDispatching,
    listStaleSending,
    recoverStaleSending,
    listOverdueUndelivered,
    markGiftOverdue,
    listDueGifts,
  };
}

module.exports = {
  createGiftDispatchRepository,
};
