"use strict";

const { nowIso } = require("../utils/common");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createWebOrdersRepository(db) {
  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error(
        "Web order mutations require database transaction support",
      );
    }
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createWebOrdersRepository(transactionDb), transactionDb);
    });
  }

  async function listActiveProducts() {
    const activeValue = db.isPostgres ? true : 1;
    return db
      .prepare(
        `SELECT id, stripe_price_id, price_key, token_count, display_name,
                display_price, currency, active
         FROM web_products
         WHERE active = ?
         ORDER BY created_at ASC`,
      )
      .all(activeValue);
  }

  async function findProductByPriceKey(priceKey) {
    return db
      .prepare(
        `SELECT id, stripe_price_id, price_key, token_count, display_name,
                display_price, currency, active
         FROM web_products
         WHERE price_key = ?`,
      )
      .get(priceKey);
  }

  async function findOpenPendingOrder({ userId, trackVersionId }) {
    return db
      .prepare(
        `SELECT * FROM web_orders
         WHERE user_id = ? AND track_version_id = ? AND status = 'pending'
         LIMIT 1`,
      )
      .get(userId, trackVersionId);
  }

  async function findByCheckoutSessionId(checkoutSessionId) {
    return db
      .prepare("SELECT * FROM web_orders WHERE checkout_session_id = ?")
      .get(checkoutSessionId);
  }

  async function findById(orderId) {
    return db.prepare("SELECT * FROM web_orders WHERE id = ?").get(orderId);
  }

  async function findOwnedById({ orderId, userId }) {
    return db.prepare("SELECT * FROM web_orders WHERE id = ? AND user_id = ?").get(orderId, userId);
  }

  async function insertOrder({
    id,
    checkoutSessionId,
    userId,
    trackId,
    trackVersionId,
    priceKey,
    amountCents,
    currency,
    email = null,
    utmSource = null,
    utmMedium = null,
    utmCampaign = null,
    paymentSource = "stripe",
    fundingModel = "legacy_song_spend",
    purchaseTransactionId = null,
    giftReservationId = null,
    status = "pending",
    query = null,
  }) {
    const now = nowIso();
    const target = query ? createPreparedDbFromQuery(query, db) : db;
    await target
      .prepare(
        `INSERT INTO web_orders (
           id, checkout_session_id, user_id, track_id, track_version_id,
           price_key, amount_cents, currency, email, status,
           render_attempts, utm_source, utm_medium, utm_campaign,
           payment_source, funding_model, purchase_transaction_id, gift_reservation_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        checkoutSessionId,
        userId,
        trackId,
        trackVersionId,
        priceKey,
        amountCents,
        currency,
        email,
        status,
        utmSource,
        utmMedium,
        utmCampaign,
        paymentSource,
        fundingModel,
        purchaseTransactionId,
        giftReservationId,
        now,
        now,
      );
    return target.prepare("SELECT * FROM web_orders WHERE id = ?").get(id);
  }

  async function linkGiftReservation({
    orderId,
    userId,
    giftReservationId,
    purchaseTransactionId = null,
    paymentSource,
    query = null,
  }) {
    const run = query
      ? (sql, params) => query(sql, params)
      : (sql, params) => db.prepare(sql).run(...params);
    const result = await run(
      `UPDATE web_orders SET
         gift_reservation_id = ?, purchase_transaction_id = COALESCE(?, purchase_transaction_id),
         payment_source = ?, funding_model = 'gift_reservation_v1', updated_at = ?
       WHERE id = ? AND user_id = ?
         AND (gift_reservation_id IS NULL OR gift_reservation_id = ?)`,
      [giftReservationId, purchaseTransactionId, paymentSource, nowIso(), orderId, userId, giftReservationId],
    );
    return result?.rowCount ?? result?.changes ?? 0;
  }

  // Compare-and-set the order status. Returns the number of affected rows so
  // callers can detect a lost race (0 = another worker already transitioned it).
  async function updateStatus({
    orderId,
    fromStatus,
    toStatus,
    query = null,
    paymentIntentId = undefined,
    email = undefined,
    buyerName = undefined,
    shareTokenId = undefined,
  }) {
    const run = query
      ? (sql, params) => query(sql, params)
      : (sql, params) => db.prepare(sql).run(...params);
    const sets = ["status = ?", "updated_at = ?"];
    const params = [toStatus, nowIso()];
    if (paymentIntentId !== undefined) {
      sets.push("payment_intent_id = COALESCE(?, payment_intent_id)");
      params.push(paymentIntentId);
    }
    if (email !== undefined) {
      sets.push("email = COALESCE(?, email)");
      params.push(email);
    }
    if (buyerName !== undefined) {
      sets.push("buyer_name = COALESCE(?, buyer_name)");
      params.push(buyerName);
    }
    if (shareTokenId !== undefined) {
      sets.push("share_token_id = COALESCE(?, share_token_id)");
      params.push(shareTokenId);
    }
    const whereStatus = Array.isArray(fromStatus) ? fromStatus : [fromStatus];
    const placeholders = whereStatus.map(() => "?").join(", ");
    const sql = `UPDATE web_orders SET ${sets.join(", ")} WHERE id = ? AND status IN (${placeholders})`;
    params.push(orderId, ...whereStatus);
    const result = await run(sql, params);
    return result?.rowCount ?? result?.changes ?? 0;
  }

  async function incrementRenderAttempts({ orderId, query = null }) {
    const run = query
      ? (sql, params) => query(sql, params)
      : (sql, params) => db.prepare(sql).run(...params);
    await run(
      "UPDATE web_orders SET render_attempts = render_attempts + 1, updated_at = ? WHERE id = ?",
      [nowIso(), orderId],
    );
  }

  // Orders that a sweep must resume: paid (never started rendering) or
  // rendering (crashed mid-flight), older than the staleness threshold.
  async function findResumableOrders({ staleBeforeIso, limit = 25 }) {
    return db
      .prepare(
        `SELECT * FROM web_orders
         WHERE status IN ('paid', 'rendering')
           AND updated_at < ?
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .all(staleBeforeIso, limit);
  }

  // The most recent purchased order owned by a user — used by the success page
  // to recover a paid song on a device that has no session_id (e.g. the buyer
  // signs in fresh on their phone after paying on desktop). Ownership is proven
  // by the authenticated user id, so this returns only that user's own order.
  async function findLatestPurchasedOrderForUser(userId) {
    return db
      .prepare(
        `SELECT * FROM web_orders
         WHERE user_id = ?
           AND status IN ('paid', 'rendering', 'delivered', 'failed', 'refunded')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(userId);
  }

  return {
    transaction,
    listActiveProducts,
    findProductByPriceKey,
    findOpenPendingOrder,
    findByCheckoutSessionId,
    findById,
    findOwnedById,
    insertOrder,
    linkGiftReservation,
    updateStatus,
    incrementRenderAttempts,
    findResumableOrders,
    findLatestPurchasedOrderForUser,
  };
}

module.exports = { createWebOrdersRepository };
