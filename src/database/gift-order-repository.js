"use strict";

const { toJson } = require("../utils/common");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createGiftOrderRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function findById(giftId, query = null) {
    return runner(query)
      .prepare("SELECT * FROM gift_orders WHERE id = ?")
      .get(giftId);
  }

  async function findBySenderAndIdempotencyKey({
    userId,
    idempotencyKey,
    query = null,
  }) {
    return runner(query)
      .prepare(
        "SELECT * FROM gift_orders WHERE sender_user_id = ? AND idempotency_key = ? LIMIT 1",
      )
      .get(userId, idempotencyKey);
  }

  async function listForUser({ userId, status = null, limit, offset }) {
    if (status) {
      return db
        .prepare(
          `SELECT * FROM gift_orders
           WHERE sender_user_id = ? AND status = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(userId, status, limit, offset);
    }

    return db
      .prepare(
        `SELECT * FROM gift_orders
         WHERE sender_user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset);
  }

  async function markCancelled({ giftId, refundTransactionId, timestamp }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = 'cancelled',
             dispatch_status = 'cancelled',
             cancelled_at = ?,
             refund_transaction_id = ?,
             next_retry_at = NULL,
             dispatch_started_at = NULL,
             updated_at = ?
         WHERE id = ? AND status IN ('scheduled', 'dispatch_retry', 'cancelled')`,
      )
      .run(timestamp, refundTransactionId, timestamp, giftId);
  }

  async function markRetrying({ giftId, retryAt, updatedAt = retryAt }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET status = 'dispatch_retry',
             dispatch_status = 'retrying',
             next_retry_at = ?,
             dispatch_started_at = NULL,
             updated_at = ?
         WHERE id = ? AND status IN ('scheduled', 'dispatch_retry', 'failed')`,
      )
      .run(retryAt, updatedAt, giftId);
  }

  async function updateSchedule({
    giftId,
    sendAt,
    senderTimezone,
    recipientName,
    channels,
    recipientPhone,
    recipientEmail,
    message,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE gift_orders
         SET send_at = ?,
             sender_timezone = ?,
             recipient_name = ?,
             channels_json = ?,
             recipient_phone = ?,
             recipient_email = ?,
             message = ?,
             next_retry_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        sendAt,
        senderTimezone,
        recipientName || null,
        toJson(channels),
        recipientPhone,
        recipientEmail,
        message || null,
        sendAt,
        updatedAt,
        giftId,
      );
  }

  async function insertScheduled({
    id,
    senderUserId,
    contentType,
    contentId,
    deliveryMode,
    sendAt,
    senderTimezone,
    recipientName,
    senderDisplayName,
    channels,
    recipientPhone,
    recipientEmail,
    message,
    shareTokenId,
    shareUrl,
    claimPin,
    claimPolicy,
    expiresInDays,
    tokenTransactionId,
    versionNum,
    contentSnapshot,
    idempotencyKey,
    timestamp,
    query = null,
  }) {
    return runner(query)
      .prepare(
        `INSERT INTO gift_orders (
          id, sender_user_id, content_type, content_id, status, dispatch_status, delivery_mode,
          send_at, sender_timezone, recipient_name, sender_display_name, channels_json, recipient_phone, recipient_email, message,
          share_token_id, share_url, claim_pin, claim_policy, expires_in_days, dispatch_attempts,
          last_dispatch_error, dispatched_at, cancelled_at, token_transaction_id, refund_transaction_id,
          version_num, content_snapshot_json, next_retry_at, dispatch_started_at, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        senderUserId,
        contentType,
        contentId,
        "scheduled",
        "pending",
        deliveryMode,
        sendAt,
        senderTimezone,
        recipientName,
        senderDisplayName,
        toJson(channels),
        recipientPhone,
        recipientEmail,
        message || null,
        shareTokenId,
        shareUrl,
        claimPin,
        claimPolicy,
        expiresInDays,
        0,
        null,
        null,
        null,
        tokenTransactionId,
        null,
        versionNum,
        contentSnapshot ? toJson(contentSnapshot) : null,
        sendAt,
        null,
        idempotencyKey,
        timestamp,
        timestamp,
      );
  }

  return {
    findById,
    findBySenderAndIdempotencyKey,
    listForUser,
    markCancelled,
    markRetrying,
    updateSchedule,
    insertScheduled,
  };
}

module.exports = {
  createGiftOrderRepository,
};
