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
  }) {
    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO web_orders (
           id, checkout_session_id, user_id, track_id, track_version_id,
           price_key, amount_cents, currency, email, status,
           render_attempts, utm_source, utm_medium, utm_campaign,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`,
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
        utmSource,
        utmMedium,
        utmCampaign,
        now,
        now,
      );
    return findById(id);
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

  return {
    transaction,
    listActiveProducts,
    findProductByPriceKey,
    findOpenPendingOrder,
    findByCheckoutSessionId,
    findById,
    insertOrder,
    updateStatus,
    incrementRenderAttempts,
    findResumableOrders,
  };
}

module.exports = { createWebOrdersRepository };
