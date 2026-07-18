"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createGiftReservationRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function getById(reservationId, query = null) {
    return runner(query)
      .prepare("SELECT * FROM gift_reservations WHERE id = ?")
      .get(reservationId);
  }

  async function findByIdempotencyKey({ userId, idempotencyKey, query = null }) {
    return runner(query)
      .prepare(
        "SELECT * FROM gift_reservations WHERE user_id = ? AND idempotency_key = ? LIMIT 1",
      )
      .get(userId, idempotencyKey);
  }

  async function findActiveForUser(userId) {
    return db
      .prepare(
        `SELECT *
         FROM gift_reservations
         WHERE user_id = ?
           AND status IN ('reserved', 'content_ready')
           AND COALESCE(purpose, 'interactive_draft') = 'interactive_draft'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(userId);
  }

  async function getActiveForTrack({ trackId, query = null }) {
    return runner(query)
      .prepare(
        `SELECT id, status
         FROM gift_reservations
         WHERE id = (SELECT gift_reservation_id FROM tracks WHERE id = ?)
           AND status IN ('reserved', 'content_ready', 'finalized')`,
      )
      .get(trackId);
  }

  async function listExpiredActive({ now, limit }) {
    return db
      .prepare(
        `SELECT *
         FROM gift_reservations gr
         WHERE gr.status IN ('reserved', 'content_ready')
           AND gr.expires_at <= ?
           AND NOT (
             COALESCE(gr.purpose, 'interactive_draft') = 'paid_web_order'
             AND EXISTS (
               SELECT 1 FROM web_orders wo
               WHERE wo.id = gr.origin_web_order_id
                 AND wo.status IN ('paid', 'rendering')
             )
           )
         ORDER BY gr.expires_at ASC
         LIMIT ?`,
      )
      .all(now, Math.max(1, Number(limit) || 50));
  }

  async function createReservation({
    id,
    userId,
    tokenTransactionId,
    idempotencyKey = null,
    expiresAt,
    createdAt,
    purpose = "interactive_draft",
    originWebOrderId = null,
    query = null,
  }) {
    await runner(query)
      .prepare(
        `INSERT INTO gift_reservations (
          id, user_id, status, content_type, content_id, version_num,
          token_transaction_id, refund_transaction_id, gift_order_id,
          idempotency_key, expires_at, cancel_reason, created_at, updated_at,
          purpose, origin_web_order_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        "reserved",
        null,
        null,
        null,
        tokenTransactionId,
        null,
        null,
        idempotencyKey,
        expiresAt,
        null,
        createdAt,
        createdAt,
        purpose,
        originWebOrderId,
      );
  }

  async function findByOriginWebOrderId(originWebOrderId, query = null) {
    return runner(query).prepare(
      "SELECT * FROM gift_reservations WHERE origin_web_order_id = ? LIMIT 1",
    ).get(originWebOrderId);
  }

  async function markRefunded({
    reservationId,
    status,
    refundTransactionId,
    cancelReason,
    updatedAt,
    query = null,
  }) {
    return runner(query)
      .prepare(
        `UPDATE gift_reservations
         SET status = ?,
             refund_transaction_id = COALESCE(?, refund_transaction_id),
             cancel_reason = ?,
             updated_at = ?
         WHERE id = ? AND status = 'refunding'`,
      )
      .run(status, refundTransactionId, cancelReason, updatedAt, reservationId);
  }

  async function claimForRefund({ reservationId, updatedAt, query = null }) {
    return runner(query)
      .prepare(
        `UPDATE gift_reservations
         SET status = 'refunding', updated_at = ?
         WHERE id = ? AND status IN ('reserved', 'content_ready')`,
      )
      .run(updatedAt, reservationId);
  }

  async function attachContent({
    reservationId,
    contentType,
    contentId,
    versionNum,
    updatedAt,
    query = null,
  }) {
    return runner(query)
      .prepare(
        `UPDATE gift_reservations
         SET status = 'content_ready',
             content_type = ?,
             content_id = ?,
             version_num = ?,
             updated_at = ?
         WHERE id = ?
           AND status IN ('reserved', 'content_ready')
           AND (content_id IS NULL OR content_id = ?)`,
      )
      .run(
        contentType,
        contentId,
        versionNum,
        updatedAt,
        reservationId,
        contentId,
      );
  }

  async function markFinalized({
    reservationId,
    giftOrderId,
    updatedAt,
    query = null,
  }) {
    return runner(query)
      .prepare(
        `UPDATE gift_reservations
         SET status = 'finalized',
             gift_order_id = ?,
             updated_at = ?
         WHERE id = ? AND status = 'finalizing' AND gift_order_id IS NULL`,
      )
      .run(giftOrderId, updatedAt, reservationId);
  }

  async function claimForFinalization({ reservationId, updatedAt, query = null }) {
    return runner(query)
      .prepare(
        `UPDATE gift_reservations
         SET status = 'finalizing', updated_at = ?
         WHERE id = ? AND status = 'content_ready' AND gift_order_id IS NULL`,
      )
      .run(updatedAt, reservationId);
  }

  return {
    getById,
    findByIdempotencyKey,
    findActiveForUser,
    findByOriginWebOrderId,
    getActiveForTrack,
    listExpiredActive,
    createReservation,
    claimForRefund,
    markRefunded,
    attachContent,
    claimForFinalization,
    markFinalized,
  };
}

module.exports = {
  createGiftReservationRepository,
};
