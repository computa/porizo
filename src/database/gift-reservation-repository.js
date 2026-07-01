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

  async function findByIdempotencyKey({ userId, idempotencyKey }) {
    return db
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
         FROM gift_reservations
         WHERE status IN ('reserved', 'content_ready')
           AND expires_at <= ?
         ORDER BY expires_at ASC
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
  }) {
    await db
      .prepare(
        `INSERT INTO gift_reservations (
          id, user_id, status, content_type, content_id, version_num,
          token_transaction_id, refund_transaction_id, gift_order_id,
          idempotency_key, expires_at, cancel_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
  }

  async function markRefunded({
    reservationId,
    status,
    refundTransactionId,
    cancelReason,
    updatedAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_reservations
         SET status = ?,
             refund_transaction_id = COALESCE(?, refund_transaction_id),
             cancel_reason = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(status, refundTransactionId, cancelReason, updatedAt, reservationId);
  }

  async function attachContent({
    reservationId,
    contentType,
    contentId,
    versionNum,
    updatedAt,
  }) {
    await db
      .prepare(
        `UPDATE gift_reservations
         SET status = 'content_ready',
             content_type = ?,
             content_id = ?,
             version_num = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(contentType, contentId, versionNum, updatedAt, reservationId);
  }

  async function markFinalized({
    reservationId,
    giftOrderId,
    updatedAt,
    query = null,
  }) {
    await runner(query)
      .prepare(
        `UPDATE gift_reservations
         SET status = 'finalized',
             gift_order_id = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(giftOrderId, updatedAt, reservationId);
  }

  return {
    getById,
    findByIdempotencyKey,
    findActiveForUser,
    getActiveForTrack,
    listExpiredActive,
    createReservation,
    markRefunded,
    attachContent,
    markFinalized,
  };
}

module.exports = {
  createGiftReservationRepository,
};
