"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");
const { z } = require("zod");

const LYRICS_TEXT = z.union([
  z.string(),
  z.object({ title: z.string(), sections: z.array(z.object({ lines: z.array(z.string()) })) })
    .transform((lyrics) => [lyrics.title, ...lyrics.sections.map((section) => section.lines.join("\n"))].join("\n\n")),
]);

function createEtsyMtoRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function transaction(callback) {
    if (!db.transaction) {
      throw new Error("Etsy MTO mutations require database transaction support");
    }
    return db.transaction(async (query) => callback(createEtsyMtoRepository(runner(query))));
  }

  async function findOrderByReceipt({ shopId, receiptId, query = null, lock = false }) {
    const lockClause = lock && db.isPostgres ? " FOR UPDATE" : "";
    return runner(query).prepare(
      `SELECT * FROM etsy_mto_orders
       WHERE shop_id = ? AND receipt_id = ?${lockClause}`,
    ).get(shopId, receiptId);
  }

  async function findItemByIdentity({
    shopId,
    receiptId,
    transactionId,
    ordinal,
    query = null,
    lock = false,
  }) {
    const lockClause = lock && db.isPostgres ? " FOR UPDATE OF i" : "";
    return runner(query).prepare(
      `SELECT i.*, o.shop_id, o.receipt_id, o.financial_state, o.state AS order_state
       FROM etsy_mto_items i
       JOIN etsy_mto_orders o ON o.id = i.etsy_mto_order_id
       WHERE o.shop_id = ? AND o.receipt_id = ?
         AND i.transaction_id = ? AND i.ordinal = ?${lockClause}`,
    ).get(shopId, receiptId, transactionId, ordinal);
  }

  async function findItemById({ itemId, query = null, lock = false }) {
    const lockClause = lock && db.isPostgres ? " FOR UPDATE" : "";
    return runner(query).prepare(
      `SELECT i.*, o.shop_id, o.receipt_id, o.financial_state, o.state AS order_state
         FROM etsy_mto_items i
         JOIN etsy_mto_orders o ON o.id = i.etsy_mto_order_id
        WHERE i.id = ?${lockClause}`,
    ).get(itemId);
  }

  async function listItems({ state = null } = {}) {
    const values = state ? [state] : [];
    const where = state ? "WHERE i.state = ?" : "";
    return db
      .prepare(
        `SELECT i.*, o.shop_id, o.receipt_id, o.financial_state, o.state AS order_state
           FROM etsy_mto_items i
           JOIN etsy_mto_orders o ON o.id = i.etsy_mto_order_id
           ${where}
          ORDER BY i.updated_at ASC`,
      )
      .all(...values);
  }

  async function createOrderAndItem({ order, item }) {
    return transaction(async (repository) => {
      const target = repository;
      await target.insertOrderIfMissing(order);
      const storedOrder = await target.findOrderByReceipt({
        shopId: order.shopId,
        receiptId: order.receiptId,
        lock: true,
      });
      await target.insertItemIfMissing({ ...item, orderId: storedOrder.id });
      const storedItem = await target.findItemByIdentity({
        shopId: order.shopId,
        receiptId: order.receiptId,
        transactionId: item.transactionId,
        ordinal: item.ordinal,
        lock: true,
      });
      return { order: storedOrder, item: storedItem };
    });
  }

  async function insertOrderIfMissing({
    id,
    shopId,
    receiptId,
    financialState = "active",
    state = "received",
    createdAt,
    updatedAt,
    query = null,
  }) {
    return runner(query).prepare(
      `INSERT INTO etsy_mto_orders (
         id, shop_id, receipt_id, financial_state, state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (shop_id, receipt_id) DO NOTHING`,
    ).run(id, shopId, receiptId, financialState, state, createdAt, updatedAt);
  }

  async function insertItemIfMissing({
    id,
    orderId,
    transactionId,
    ordinal,
    listingId,
    briefJson,
    rawPersonalizationHash,
    state = "received",
    createdAt,
    updatedAt,
    query = null,
  }) {
    return runner(query).prepare(
      `INSERT INTO etsy_mto_items (
         id, etsy_mto_order_id, transaction_id, ordinal, listing_id, brief_json,
         raw_personalization_hash, state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (etsy_mto_order_id, transaction_id, ordinal) DO NOTHING`,
    ).run(
      id, orderId, transactionId, ordinal, listingId, briefJson,
      rawPersonalizationHash, state, createdAt, updatedAt,
    );
  }

  async function recordIdempotencyEvent({
    id,
    itemId,
    eventType,
    idempotencyKey,
    requestHash,
    metadataJson = null,
    createdAt,
    query = null,
  }) {
    const result = await runner(query).prepare(
      `INSERT INTO etsy_mto_events (
         id, etsy_mto_item_id, event_type, idempotency_key, request_hash,
         metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (etsy_mto_item_id, idempotency_key) DO NOTHING`,
    ).run(id, itemId, eventType, idempotencyKey, requestHash, metadataJson, createdAt);
    const event = await findEventByIdempotencyKey({ itemId, idempotencyKey, query });
    return { event, created: (result.rowCount ?? result.changes) === 1 };
  }

  async function findEventByIdempotencyKey({ itemId, idempotencyKey, query = null }) {
    return runner(query).prepare(
      `SELECT * FROM etsy_mto_events
       WHERE etsy_mto_item_id = ? AND idempotency_key = ?`,
    ).get(itemId, idempotencyKey);
  }

  async function transitionItem({ itemId, fromStates, state, updatedAt, query = null, leaseToken = null }) {
    if (!Array.isArray(fromStates) || fromStates.length === 0) {
      throw new Error("Etsy MTO transitions require at least one source state");
    }
    const placeholders = fromStates.map(() => "?").join(", ");
    return runner(query).prepare(
      `UPDATE etsy_mto_items SET state = ?, updated_at = ?
       WHERE id = ? AND state IN (${placeholders}) AND (CAST(? AS TEXT) IS NULL OR lease_token = ?)`,
    ).run(state, updatedAt, itemId, ...fromStates, leaseToken, leaseToken);
  }

  async function linkTrack({ itemId, trackId, trackVersionId = null, updatedAt, query = null, leaseToken = null }) {
    return runner(query).prepare(
      `UPDATE etsy_mto_items
       SET track_id = ?, track_version_id = COALESCE(?, track_version_id), updated_at = ?
       WHERE id = ? AND (CAST(? AS TEXT) IS NULL OR lease_token = ?)`,
    ).run(trackId, trackVersionId, updatedAt, itemId, leaseToken, leaseToken);
  }

  async function assertClaim(itemId, token, now) {
    const row = await db.prepare("SELECT id FROM etsy_mto_items WHERE id = ? AND lease_token = ? AND lease_until > ?").get(itemId, token, now);
    if (!row) throw Object.assign(new Error("Etsy processing claim was lost."), { code: "ETSY_CLAIM_LOST" });
  }

  async function claimItem(itemId, token, now, until) {
    const result = await db.prepare(
      `UPDATE etsy_mto_items SET lease_token = ?, lease_until = ?
       WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)
       AND state IN ('received', 'verified_paid', 'lyrics_review', 'rendering')`,
    ).run(token, until, itemId, now);
    return (result.rowCount ?? result.changes) === 1;
  }

  async function releaseItem(itemId, token, now) {
    await db.prepare(
      "UPDATE etsy_mto_items SET lease_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND lease_token = ?",
    ).run(now, itemId, token);
  }

  async function failItem(itemId, token, error, now) {
    await db.prepare(
      `UPDATE etsy_mto_items SET state = 'needs_attention', last_error = ?, updated_at = ?
       WHERE id = ? AND lease_token = ?
       AND state IN ('received', 'verified_paid', 'lyrics_review', 'rendering')`,
    ).run(error, now, itemId, token);
  }

  async function retryFailedRender({ itemId, idempotencyKey, requestHash, eventId, updatedAt }) {
    return db.transaction(async (query) => {
      const tx = runner(query);
      const item = await tx.prepare(
        `SELECT i.*, o.shop_id, o.receipt_id, o.financial_state, o.state AS order_state
           FROM etsy_mto_items i
           JOIN etsy_mto_orders o ON o.id = i.etsy_mto_order_id
          WHERE i.id = ?`,
      ).get(itemId);
      if (!item) throw Object.assign(new Error("Etsy item was not found."), { code: "ETSY_MTO_NOT_FOUND" });

      const existing = await tx.prepare(
        "SELECT * FROM etsy_mto_events WHERE etsy_mto_item_id = ? AND idempotency_key = ?",
      ).get(itemId, idempotencyKey);
      if (existing) {
        if (existing.event_type !== "render_retry" || existing.request_hash !== requestHash) {
          throw Object.assign(new Error("The idempotency key was reused with different input."), { code: "ETSY_IDEMPOTENCY_CONFLICT" });
        }
        const job = await tx.prepare(
          `SELECT j.* FROM jobs j
           JOIN track_versions v ON v.full_job_id = j.id
           WHERE v.id = ? AND j.workflow_type = 'full_render'`,
        ).get(item.track_version_id);
        return { item, job, idempotent: true };
      }

      if (item.state !== "needs_attention" || item.last_error !== "ETSY_RENDER_FAILED" || !item.track_id || !item.track_version_id) {
        throw Object.assign(new Error("Only a failed Etsy render can be retried."), { code: "ETSY_RENDER_RETRY_CONFLICT" });
      }

      const job = await tx.prepare(
        `SELECT j.* FROM jobs j
         JOIN track_versions v ON v.full_job_id = j.id
         WHERE v.id = ? AND j.workflow_type = 'full_render' AND j.status IN ('failed', 'dead_letter')`,
      ).get(item.track_version_id);
      if (!job) throw Object.assign(new Error("The linked render job is not failed."), { code: "ETSY_RENDER_RETRY_CONFLICT" });

      await tx.prepare(
        "UPDATE jobs SET status = 'queued', step = 'queued', step_index = 0, attempts = 0, error_code = NULL, error_message = NULL, progress_pct = 0, completed_at = NULL, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'dead_letter')",
      ).run(updatedAt, job.id);
      await tx.prepare("UPDATE track_versions SET status = 'processing' WHERE id = ?").run(item.track_version_id);
      await tx.prepare("UPDATE tracks SET status = 'rendering', updated_at = ? WHERE id = ?").run(updatedAt, item.track_id);
      await tx.prepare(
        "UPDATE etsy_mto_items SET state = 'rendering', last_error = NULL, lease_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND state = 'needs_attention'",
      ).run(updatedAt, itemId);
      await tx.prepare(
        "UPDATE dead_letter_queue SET reprocessed_at = ?, reprocess_job_id = ? WHERE job_id = ? AND reprocessed_at IS NULL",
      ).run(updatedAt, job.id, job.id);
      const event = await tx.prepare(
        `INSERT INTO etsy_mto_events (
           id, etsy_mto_item_id, event_type, idempotency_key, request_hash, created_at
         ) VALUES (?, ?, 'render_retry', ?, ?, ?)`,
      ).run(eventId, itemId, idempotencyKey, requestHash, updatedAt);
      if ((event.rowCount ?? event.changes) !== 1) throw Object.assign(new Error("The render retry changed concurrently."), { code: "ETSY_RENDER_RETRY_CONFLICT" });
      return {
        item: await tx.prepare(
          `SELECT i.*, o.shop_id, o.receipt_id, o.financial_state, o.state AS order_state
             FROM etsy_mto_items i
             JOIN etsy_mto_orders o ON o.id = i.etsy_mto_order_id
            WHERE i.id = ?`,
        ).get(itemId),
        job: await tx.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id),
        idempotent: false,
      };
    });
  }

  async function readLyrics(itemId) {
    const row = await db.prepare(
      `SELECT v.lyrics_json FROM etsy_mto_items i
       JOIN track_versions v ON v.id = i.track_version_id WHERE i.id = ?`,
    ).get(itemId);
    return row?.lyrics_json ? LYRICS_TEXT.parse(JSON.parse(row.lyrics_json)) : null;
  }

  return {
    transaction,
    assertClaim,
    findOrderByReceipt,
    findItemByIdentity,
    findItemById,
    listItems,
    createOrderAndItem,
    insertOrderIfMissing,
    insertItemIfMissing,
    recordIdempotencyEvent,
    findEventByIdempotencyKey,
    transitionItem,
    linkTrack,
    claimItem,
    releaseItem,
    failItem,
    retryFailedRender,
    readLyrics,
  };
}

module.exports = { createEtsyMtoRepository };
