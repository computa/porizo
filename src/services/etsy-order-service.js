"use strict";

const crypto = require("node:crypto");
const { nowIso } = require("../utils/common");
const {
  decryptValue,
  encryptValue,
  lookupHash,
  lookupHashes,
} = require("./etsy-secrets");

function rows(result) {
  return result?.rows || (Array.isArray(result) ? result : []);
}

function changes(result) {
  return result?.rowCount ?? result?.changes ?? 0;
}

function domainError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeReceiptId(value) {
  const normalized = String(value || "").trim();
  if (!/^[0-9]{1,32}$/.test(normalized)) {
    throw domainError("INVALID_ETSY_RECEIPT", "Receipt reference is invalid.");
  }
  return normalized;
}

const PAID_RECEIPT_STATUSES = new Set([
  "paid",
  "completed",
  "processing",
  "payment processing",
  "open",
]);
const TERMINAL_RECEIPT_STATUSES = new Set([
  "canceled",
  "cancelled",
  "fully refunded",
  "fully_refunded",
  "refunded",
]);

function normalizeProviderStatus(receipt) {
  return String(receipt?.status || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function providerUpdatedAt(receipt) {
  const seconds = Number(
    receipt?.update_timestamp || receipt?.updated_timestamp || 0,
  );
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : nowIso();
}

function extractPaymentAdjustments(payload) {
  const payments = Array.isArray(payload?.results) ? payload.results : [payload];
  return payments.flatMap((payment) =>
    Array.isArray(payment?.payment_adjustments)
      ? payment.payment_adjustments
      : [],
  );
}

function flattenAdjustmentItems(adjustments) {
  return adjustments.flatMap((adjustment, adjustmentIndex) => {
    const items = Array.isArray(adjustment?.payment_adjustment_items)
      ? adjustment.payment_adjustment_items
      : [];
    if (items.length === 0) {
      return [{ adjustment, item: adjustment, adjustmentIndex, itemIndex: 0 }];
    }
    return items.map((item, itemIndex) => ({
      adjustment,
      item,
      adjustmentIndex,
      itemIndex,
    }));
  });
}

function createEtsyOrderService({
  db,
  giftWalletRepository,
  giftPurchaseReversalService = null,
  revokeBoundOrder = null,
  configuredShopId = process.env.ETSY_SHOP_ID,
  allowedListingIds = String(process.env.ETSY_LISTING_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
}) {
  const allowed = new Set(allowedListingIds.map(String));

  function validateReceipt(receipt) {
    const shopId = String(receipt?.shop_id || configuredShopId || "");
    if (!configuredShopId || shopId !== String(configuredShopId)) {
      throw domainError("ETSY_SHOP_MISMATCH", "Receipt shop is not configured.");
    }
    const providerStatus = normalizeProviderStatus(receipt);
    const isTerminal =
      TERMINAL_RECEIPT_STATUSES.has(providerStatus) ||
      providerStatus.includes("cancel") ||
      providerStatus.includes("refund");
    const statusEligible = PAID_RECEIPT_STATUSES.has(providerStatus);
    if (!receipt?.is_paid || isTerminal || !statusEligible) {
      throw domainError("ETSY_ORDER_NOT_PAID", "Receipt is not a paid order.");
    }
    if (!receipt?.buyer_email) {
      throw domainError(
        "ETSY_BUYER_EMAIL_UNAVAILABLE",
        "Receipt buyer email is unavailable.",
      );
    }
    const transactions = Array.isArray(receipt.transactions)
      ? receipt.transactions
      : [];
    if (transactions.length === 0) {
      throw domainError(
        "ETSY_TRANSACTIONS_UNAVAILABLE",
        "Receipt transactions are not available yet.",
      );
    }
    const eligibleTransactions = [];
    const transactionIds = new Set();
    for (const transaction of transactions) {
      const listingId = String(transaction.listing_id || "");
      if (allowed.size === 0 || !allowed.has(listingId)) continue;
      const transactionId = String(transaction.transaction_id || "").trim();
      if (!transactionId || transactionId === "undefined") {
        throw domainError(
          "ETSY_TRANSACTION_INVALID",
          "Receipt transaction identity is invalid.",
        );
      }
      if (transactionIds.has(transactionId)) {
        throw domainError(
          "ETSY_TRANSACTION_DUPLICATE",
          "Receipt contains duplicate transaction identities.",
        );
      }
      transactionIds.add(transactionId);
      const quantity = Number(transaction.quantity || 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        throw domainError("ETSY_QUANTITY_INVALID", "Receipt quantity is invalid.");
      }
      eligibleTransactions.push(transaction);
    }
    if (eligibleTransactions.length === 0) {
      throw domainError(
        "ETSY_LISTING_NOT_ALLOWED",
        "Receipt contains no configured song listing.",
      );
    }
    return { shopId, transactions: eligibleTransactions, providerStatus };
  }

  async function ingestPaidReceipt(receipt) {
    const receiptId = normalizeReceiptId(receipt?.receipt_id);
    const { shopId, transactions, providerStatus } = validateReceipt(receipt);
    const now = nowIso();
    return db.transaction(async (query) => {
      const orderId = `etsy_order_${crypto
        .createHash("sha256")
        .update(`${shopId}:${receiptId}`)
        .digest("hex")
        .slice(0, 24)}`;
      const existing = rows(
        await query(
          `SELECT id, state, is_canceled FROM etsy_orders
            WHERE shop_id = ? AND receipt_id = ?${
              db.isPostgres ? " FOR UPDATE" : ""
            }`,
          [shopId, receiptId],
        ),
      )[0];
      if (
        existing &&
        (existing.is_canceled ||
          ["canceled", "refunded", "manual_review"].includes(existing.state))
      ) {
        return {
          orderId: existing.id,
          receiptId,
          unitIds: [],
          ignored: true,
          reason: "terminal_order",
        };
      }
      await query(
        `INSERT INTO etsy_orders
          (id, shop_id, receipt_id, buyer_user_id, buyer_email_encrypted,
           buyer_email_lookup_hash, currency, amount_minor, provider_status,
           provider_updated_at, is_paid, is_canceled,
           state, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)
         ON CONFLICT (shop_id, receipt_id) DO UPDATE SET
           buyer_user_id = excluded.buyer_user_id,
           buyer_email_encrypted = excluded.buyer_email_encrypted,
           buyer_email_lookup_hash = excluded.buyer_email_lookup_hash,
           currency = excluded.currency,
           amount_minor = excluded.amount_minor,
           provider_status = excluded.provider_status,
           provider_updated_at = excluded.provider_updated_at,
           is_paid = CASE WHEN etsy_orders.is_canceled = ${
             db.isPostgres ? "TRUE" : "1"
           } THEN etsy_orders.is_paid ELSE excluded.is_paid END,
           paid_at = COALESCE(etsy_orders.paid_at, excluded.paid_at),
           updated_at = excluded.updated_at`,
        [
          orderId,
          shopId,
          receiptId,
          receipt.buyer_user_id ? String(receipt.buyer_user_id) : null,
          encryptValue(String(receipt.buyer_email).trim().toLowerCase()),
          lookupHash(receipt.buyer_email),
          receipt.currency_code || null,
          Number(receipt.grandtotal?.amount || receipt.amount_minor || 0),
          providerStatus || "paid",
          providerUpdatedAt(receipt),
          db.isPostgres ? true : 1,
          db.isPostgres ? false : 0,
          receipt.create_timestamp
            ? new Date(Number(receipt.create_timestamp) * 1000).toISOString()
            : now,
          now,
          now,
        ],
      );

      const unitIds = [];
      for (const transaction of transactions) {
        const transactionId = String(transaction.transaction_id);
        const listingId = String(transaction.listing_id);
        const quantity = Number(transaction.quantity || 1);
        for (let ordinal = 1; ordinal <= quantity; ordinal += 1) {
          const unitId = `etsy_unit_${crypto
            .createHash("sha256")
            .update(`${orderId}:${transactionId}:${ordinal}`)
            .digest("hex")
            .slice(0, 24)}`;
          await query(
            `INSERT INTO etsy_order_units
              (id, etsy_order_id, transaction_id, listing_id, ordinal, state,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)
             ON CONFLICT (etsy_order_id, transaction_id, ordinal) DO NOTHING`,
            [unitId, orderId, transactionId, listingId, ordinal, now, now],
          );
          unitIds.push(unitId);
        }
      }
      const persisted = rows(
        await query(
          `SELECT id FROM etsy_order_units
            WHERE etsy_order_id = ?
            ORDER BY transaction_id, ordinal`,
          [orderId],
        ),
      ).map((row) => row.id);
      if (persisted.length !== unitIds.length) {
        await query(
          `UPDATE etsy_orders SET state = 'manual_review',
             manual_review_reason = 'ETSY_UNIT_COUNT_MISMATCH', updated_at = ?
           WHERE id = ?`,
          [nowIso(), orderId],
        );
        throw domainError(
          "ETSY_UNIT_COUNT_MISMATCH",
          "Receipt unit count requires review.",
        );
      }
      return { orderId, receiptId, unitIds: persisted };
    });
  }

  async function ingestCanceledReceipt(receipt, { providerEventId } = {}) {
    const receiptId = normalizeReceiptId(receipt?.receipt_id);
    const shopId = String(receipt?.shop_id || configuredShopId || "");
    if (!configuredShopId || shopId !== String(configuredShopId)) {
      throw domainError("ETSY_SHOP_MISMATCH", "Receipt shop is not configured.");
    }
    const now = nowIso();
    const orderId = `etsy_order_${crypto
      .createHash("sha256")
      .update(`${shopId}:${receiptId}`)
      .digest("hex")
      .slice(0, 24)}`;
    await db.transaction(async (query) => {
      await query(
        `INSERT INTO etsy_orders
          (id, shop_id, receipt_id, buyer_user_id, buyer_email_encrypted,
           buyer_email_lookup_hash, currency, amount_minor, provider_status,
           provider_updated_at, is_paid, is_canceled, state, canceled_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'canceled', ?, ?, ?)
         ON CONFLICT(shop_id, receipt_id) DO UPDATE SET
           provider_status = excluded.provider_status,
           provider_updated_at = excluded.provider_updated_at,
           is_canceled = ${db.isPostgres ? "TRUE" : "1"},
           state = CASE
             WHEN etsy_orders.state = 'refunded' THEN 'refunded'
             ELSE 'canceled'
           END,
           canceled_at = COALESCE(etsy_orders.canceled_at, excluded.canceled_at),
           updated_at = excluded.updated_at`,
        [
          orderId,
          shopId,
          receiptId,
          receipt?.buyer_user_id ? String(receipt.buyer_user_id) : null,
          receipt?.buyer_email
            ? encryptValue(String(receipt.buyer_email).trim().toLowerCase())
            : null,
          receipt?.buyer_email ? lookupHash(receipt.buyer_email) : null,
          receipt?.currency_code || null,
          Number(receipt?.grandtotal?.amount || receipt?.amount_minor || 0),
          normalizeProviderStatus(receipt) || "canceled",
          providerUpdatedAt(receipt),
          receipt?.is_paid ? (db.isPostgres ? true : 1) : (db.isPostgres ? false : 0),
          db.isPostgres ? true : 1,
          now,
          now,
          now,
        ],
      );
    });
    return cancelReceipt({
      receiptId,
      providerEventId: providerEventId || `etsy_cancel:${receiptId}`,
    });
  }

  async function syncReceipt(receipt, { providerEventId } = {}) {
    const status = normalizeProviderStatus(receipt);
    if (status.includes("partial") && status.includes("refund")) {
      const adjustments = [
        ...(Array.isArray(receipt?.refunds) ? receipt.refunds : []),
        ...(Array.isArray(receipt?.payment_adjustments)
          ? receipt.payment_adjustments
          : []),
      ];
      const ingested = await ingestPaidReceipt({ ...receipt, status: "paid" });
      await db.transaction(async (query) => {
        let refundedAmount = 0;
        for (const {
          adjustment,
          item,
          adjustmentIndex,
          itemIndex,
        } of flattenAdjustmentItems(adjustments)) {
          const adjustmentId = String(
            adjustment?.adjustment_id || adjustment?.refund_id || "unknown",
          );
          const itemId = String(
            item?.payment_adjustment_item_id ||
              item?.adjustment_item_id ||
              item?.id ||
              `${adjustmentId}:${adjustmentIndex}:${itemIndex}`,
          );
          const amountMinor = Number(
            item?.adjustment_amount?.amount ||
              item?.amount?.amount ||
              item?.amount_minor ||
              adjustment?.total_adjustment_amount ||
              0,
          );
          refundedAmount += Math.max(amountMinor, 0);
          await query(
            `INSERT INTO etsy_payment_adjustments
              (adjustment_item_id, adjustment_id, etsy_order_id,
               transaction_id, amount_minor, currency, status, processed_at,
               created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(adjustment_item_id) DO NOTHING`,
            [
              itemId,
              adjustmentId,
              ingested.orderId,
              item?.transaction_id ? String(item.transaction_id) : null,
              amountMinor,
              receipt?.currency_code || null,
              String(adjustment?.status || "succeeded"),
              nowIso(),
              nowIso(),
            ],
          );
        }
        await query(
          `UPDATE etsy_orders
              SET refunded_amount_minor = CASE
                    WHEN refunded_amount_minor > ? THEN refunded_amount_minor
                    ELSE ?
                  END,
                  updated_at = ?
            WHERE id = ?`,
          [refundedAmount, refundedAmount, nowIso(), ingested.orderId],
        );
      });
      await db
        .prepare(
          `UPDATE etsy_orders
              SET state = 'manual_review',
                  manual_review_reason = 'ETSY_PARTIAL_REFUND_REQUIRES_REVIEW',
                  provider_status = ?, provider_updated_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(status, providerUpdatedAt(receipt), nowIso(), ingested.orderId);
      return { manualReview: true, orderId: ingested.orderId };
    }
    if (
      TERMINAL_RECEIPT_STATUSES.has(status) ||
      status.includes("cancel") ||
      status.includes("refund")
    ) {
      return ingestCanceledReceipt(receipt, { providerEventId });
    }
    return ingestPaidReceipt(receipt);
  }

  async function refundTransactions({
    receiptId: rawReceiptId,
    transactionIds,
    providerEventId,
    providerStatus = "partially_refunded",
  }) {
    const receiptId = normalizeReceiptId(rawReceiptId);
    const wanted = new Set((transactionIds || []).map(String));
    return db.transaction(async (query) => {
      const order = rows(
        await query(
          `SELECT * FROM etsy_orders WHERE receipt_id = ?${
            db.isPostgres ? " FOR UPDATE" : ""
          }`,
          [receiptId],
        ),
      )[0];
      if (!order) return { found: false, reversed: 0 };
      const units = rows(
        await query(
          `SELECT * FROM etsy_order_units WHERE etsy_order_id = ?${
            db.isPostgres ? " FOR UPDATE" : ""
          }`,
          [order.id],
        ),
      ).filter((unit) => wanted.has(String(unit.transaction_id)));
      let reversed = 0;
      for (const unit of units) {
        if (
          unit.owner_user_id &&
          unit.grant_transaction_id &&
          giftPurchaseReversalService &&
          !["canceled", "refunded"].includes(unit.state)
        ) {
          if (unit.web_order_id && revokeBoundOrder) {
            await revokeBoundOrder({ unit, providerEventId, query });
          }
          await giftPurchaseReversalService.reverseGiftPurchaseGrant({
            userId: unit.owner_user_id,
            purchaseTransactionId: unit.grant_transaction_id,
            tokenCount: 1,
            provider: "etsy",
            providerEventId: `${providerEventId}:${unit.id}`,
            externalQuery: query,
          });
          reversed += 1;
        }
        await query(
          `UPDATE etsy_order_units
              SET state = 'refunded', refunded_at = COALESCE(refunded_at, ?),
                  updated_at = ?
            WHERE id = ? AND state NOT IN ('canceled', 'refunded')`,
          [nowIso(), nowIso(), unit.id],
        );
      }
      const outstanding = rows(
        await query(
          `SELECT COUNT(*) AS count FROM etsy_order_units
            WHERE etsy_order_id = ?
              AND state NOT IN ('canceled', 'refunded')`,
          [order.id],
        ),
      )[0];
      await query(
        `UPDATE etsy_orders
            SET state = ?, provider_status = ?, provider_updated_at = ?,
                manual_review_reason = ?, updated_at = ?
          WHERE id = ?`,
        [
          Number(outstanding?.count || 0) === 0 ? "refunded" : "manual_review",
          providerStatus,
          nowIso(),
          Number(outstanding?.count || 0) === 0
            ? null
            : "ETSY_PARTIAL_REFUND_APPLIED",
          nowIso(),
          order.id,
        ],
      );
      return { found: true, reversed, orderId: order.id };
    });
  }

  async function claimByVerifiedEmail({
    receiptId: rawReceiptId,
    email,
    emails,
    userId,
  }) {
    const receiptId = normalizeReceiptId(rawReceiptId);
    const verifiedEmails = [...new Set(
      (Array.isArray(emails) ? emails : [email])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    )];
    if (verifiedEmails.length === 0 || !userId) {
      throw domainError("ETSY_CLAIM_IDENTITY_REQUIRED", "Verified identity required.");
    }
    const emailHashes = [...new Set(verifiedEmails.flatMap(lookupHashes))];
    return db.transaction(async (query) => {
      const orderResult = await query(
        `SELECT * FROM etsy_orders
          WHERE receipt_id = ?
            AND buyer_email_lookup_hash IN (${emailHashes.map(() => "?").join(",")})
            AND is_paid = ${db.isPostgres ? "TRUE" : "1"}
            AND is_canceled = ${db.isPostgres ? "FALSE" : "0"}
            AND state IN ('paid', 'claimed', 'fulfilled')${
              db.isPostgres ? " FOR UPDATE" : ""
            }`,
        [receiptId, ...emailHashes],
      );
      const order = rows(orderResult)[0];
      if (!order) {
        throw domainError("ETSY_ORDER_NOT_FOUND", "Order was not found.");
      }
      if (order.owner_user_id && order.owner_user_id !== userId) {
        throw domainError("ETSY_ORDER_ALREADY_CLAIMED", "Order is already claimed.");
      }
      const unitResult = await query(
        `SELECT * FROM etsy_order_units
          WHERE etsy_order_id = ? AND state IN ('paid', 'claimed')
          ORDER BY transaction_id, ordinal${db.isPostgres ? " FOR UPDATE" : ""}`,
        [order.id],
      );
      const claimedUnits = [];
      for (const unit of rows(unitResult)) {
        const grant = await giftWalletRepository.applyTransaction({
          userId,
          type: "etsy_purchase_grant",
          amount: 1,
          source: "etsy",
          referenceType: "etsy_order_unit",
          referenceId: unit.id,
          description: "Etsy purchase gift credit",
          idempotencyKey: `etsy_order_unit:${unit.id}`,
          externalQuery: query,
        });
        await query(
          `UPDATE etsy_order_units
              SET owner_user_id = ?, state = 'claimed',
                  grant_transaction_id = COALESCE(grant_transaction_id, ?),
                  claimed_at = COALESCE(claimed_at, ?), updated_at = ?
            WHERE id = ?`,
          [userId, grant.transactionId || grant.id || null, nowIso(), nowIso(), unit.id],
        );
        claimedUnits.push(unit.id);
      }
      if (claimedUnits.length > 0) {
        const now = nowIso();
        await query(
          `UPDATE etsy_orders
              SET owner_user_id = ?,
                  state = CASE WHEN state = 'paid' THEN 'claimed' ELSE state END,
                  claimed_at = COALESCE(claimed_at, ?), updated_at = ?
            WHERE id = ?`,
          [userId, now, now, order.id],
        );
      }
      const allOwnedUnits = rows(
        await query(
          `SELECT id FROM etsy_order_units
            WHERE etsy_order_id = ? AND owner_user_id = ?
            ORDER BY transaction_id, ordinal`,
          [order.id, userId],
        ),
      ).map((unit) => unit.id);
      return {
        orderId: order.id,
        receiptId,
        unitIds: allOwnedUnits,
        balance: await giftWalletRepository.getBalance(userId, { query }),
      };
    });
  }

  async function cancelReceipt({ receiptId: rawReceiptId, providerEventId }) {
    const receiptId = normalizeReceiptId(rawReceiptId);
    return db.transaction(async (query) => {
      const result = await query(
        `SELECT * FROM etsy_orders WHERE receipt_id = ?${
          db.isPostgres ? " FOR UPDATE" : ""
        }`,
        [receiptId],
      );
      const order = rows(result)[0];
      if (!order) return { found: false, reversed: 0 };
      const unitResult = await query(
        `SELECT * FROM etsy_order_units WHERE etsy_order_id = ?${
          db.isPostgres ? " FOR UPDATE" : ""
        }`,
        [order.id],
      );
      let reversed = 0;
      for (const unit of rows(unitResult)) {
        if (["canceled", "refunded"].includes(unit.state)) continue;
        if (unit.state === "paid" || unit.state === "claim_pending") {
          await query(
            `UPDATE etsy_order_units SET state = 'canceled', updated_at = ? WHERE id = ?`,
            [nowIso(), unit.id],
          );
          continue;
        }
        if (
          unit.owner_user_id &&
          unit.grant_transaction_id &&
          giftPurchaseReversalService
        ) {
          if (unit.web_order_id && revokeBoundOrder) {
            await revokeBoundOrder({ unit, providerEventId, query });
          }
          await giftPurchaseReversalService.reverseGiftPurchaseGrant({
            userId: unit.owner_user_id,
            purchaseTransactionId: unit.grant_transaction_id,
            tokenCount: 1,
            provider: "etsy",
            providerEventId: `${providerEventId}:${unit.id}`,
            externalQuery: query,
          });
          reversed += 1;
        }
        await query(
          `UPDATE etsy_order_units
              SET state = 'refunded', refunded_at = COALESCE(refunded_at, ?),
                  updated_at = ?
            WHERE id = ? AND state NOT IN ('canceled', 'refunded')`,
          [nowIso(), nowIso(), unit.id],
        );
      }
      await query(
        `UPDATE etsy_orders
            SET is_canceled = ${db.isPostgres ? "TRUE" : "1"},
                state = 'canceled', canceled_at = COALESCE(canceled_at, ?),
                updated_at = ?
          WHERE id = ? AND state != 'refunded'`,
        [nowIso(), nowIso(), order.id],
      );
      return { found: true, reversed };
    });
  }

  async function recordWebhook({
    webhookId,
    eventType,
    shopId,
    receiptId,
    bodySha256,
  }) {
    const result = await db
      .prepare(
        `INSERT INTO etsy_webhook_events
          (webhook_id, event_type, shop_id, receipt_id, body_sha256, status,
           received_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(webhook_id) DO NOTHING`,
      )
      .run(webhookId, eventType, shopId, receiptId, bodySha256, nowIso());
    if (changes(result) > 0) return { inserted: true };
    const existing = await db
      .prepare(
        `SELECT event_type, shop_id, receipt_id, body_sha256
           FROM etsy_webhook_events WHERE webhook_id = ?`,
      )
      .get(webhookId);
    const identical =
      existing?.event_type === eventType &&
      String(existing?.shop_id || "") === String(shopId || "") &&
      String(existing?.receipt_id || "") === String(receiptId || "") &&
      existing?.body_sha256 === bodySha256;
    if (!identical) {
      throw domainError(
        "ETSY_WEBHOOK_ID_CONFLICT",
        "Webhook ID was reused with a different signed payload.",
      );
    }
    return { inserted: false };
  }

  async function processWebhook(webhookId, etsyClient) {
    const now = nowIso();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const claimed = await db
      .prepare(
        `UPDATE etsy_webhook_events
            SET status = 'processing', attempt_count = attempt_count + 1,
                processing_started_at = ?, next_attempt_at = NULL,
                last_error = NULL
          WHERE webhook_id = ?
            AND (
              status = 'pending'
              OR (status = 'failed'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
              OR (status = 'processing' AND processing_started_at < ?)
            )
            AND attempt_count < 8`,
      )
      .run(now, webhookId, now, staleBefore);
    if (changes(claimed) === 0) return { processed: false };

    const event = await db
      .prepare("SELECT * FROM etsy_webhook_events WHERE webhook_id = ?")
      .get(webhookId);
    try {
      if (event.event_type === "order.paid") {
        let receipt = await etsyClient.getReceipt(event.receipt_id);
        const status = normalizeProviderStatus(receipt);
        if (
          status.includes("refund") &&
          typeof etsyClient.getPaymentByReceiptId === "function"
        ) {
          const payment = await etsyClient.getPaymentByReceiptId(event.receipt_id);
          receipt = {
            ...receipt,
            payment_adjustments: extractPaymentAdjustments(payment),
          };
        }
        await syncReceipt(receipt, { providerEventId: event.webhook_id });
      } else if (event.event_type === "order.canceled") {
        const receipt = await etsyClient.getReceipt(event.receipt_id);
        await ingestCanceledReceipt(receipt, {
          providerEventId: event.webhook_id,
        });
      } else {
        throw domainError("ETSY_EVENT_UNSUPPORTED", "Unsupported Etsy event.");
      }
      const completed = await db
        .prepare(
          `UPDATE etsy_webhook_events
              SET status = 'completed', processed_at = ?,
                  processing_started_at = NULL, next_attempt_at = NULL,
                  last_error = NULL
            WHERE webhook_id = ? AND status = 'processing'
              AND attempt_count = ? AND processing_started_at = ?`,
        )
        .run(
          nowIso(),
          webhookId,
          event.attempt_count,
          event.processing_started_at,
        );
      if (changes(completed) !== 1) {
        return { processed: false, staleLease: true };
      }
      return { processed: true, status: "completed" };
    } catch (error) {
      const terminal = Number(event.attempt_count || 0) >= 8;
      const retryAfterValue = String(error?.retryAfter || "").trim();
      const retryAfterSeconds = /^\d+$/.test(retryAfterValue)
        ? Number(retryAfterValue)
        : Math.max(
            0,
            Math.ceil((Date.parse(retryAfterValue) - Date.now()) / 1000) || 0,
          );
      const providerRetryMs = retryAfterSeconds * 1000;
      const retryAt = terminal
        ? null
        : new Date(
            Date.now() +
              Math.max(
                providerRetryMs,
                Math.min(
                  30 * 60_000,
                  30_000 *
                    2 ** Math.max(Number(event.attempt_count || 1) - 1, 0),
                ),
              ),
          ).toISOString();
      await db
        .prepare(
          `UPDATE etsy_webhook_events
              SET status = ?, next_attempt_at = ?,
                  processing_started_at = NULL, last_error = ?
            WHERE webhook_id = ? AND status = 'processing'
              AND attempt_count = ? AND processing_started_at = ?`,
        )
        .run(
          terminal ? "dead_letter" : "failed",
          retryAt,
          String(error?.code || error?.message || "ETSY_PROCESSING_FAILED").slice(
            0,
            500,
          ),
          webhookId,
          event.attempt_count,
          event.processing_started_at,
        );
      throw error;
    }
  }

  async function processPendingWebhooks(etsyClient, { limit = 10 } = {}) {
    const events = await db
      .prepare(
        `SELECT webhook_id
           FROM etsy_webhook_events
          WHERE (
              status = 'pending'
              OR (status = 'failed'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
              OR (status = 'processing' AND processing_started_at < ?)
            )
            AND attempt_count < 8
          ORDER BY received_at ASC
          LIMIT ?`,
      )
      .all(
        nowIso(),
        new Date(Date.now() - 5 * 60_000).toISOString(),
        Math.min(Math.max(Number(limit) || 10, 1), 50),
      );
    const results = [];
    for (const event of events) {
      try {
        results.push(await processWebhook(event.webhook_id, etsyClient));
      } catch (error) {
        results.push({
          processed: false,
          webhookId: event.webhook_id,
          error: error?.code || error?.message,
        });
      }
    }
    return results;
  }

  async function reconcileReceipts(
    etsyClient,
    { overlapMinutes = 15, pageSize = 50, maxPages = 20 } = {},
  ) {
    if (!etsyClient?.listShopReceipts) {
      throw domainError(
        "ETSY_RECONCILIATION_UNAVAILABLE",
        "Receipt reconciliation is not configured.",
      );
    }
    const shopId = String(configuredShopId || "");
    const now = nowIso();
    const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const claimed = await db
      .prepare(
        `UPDATE etsy_connections
            SET reconciliation_lease_until = ?, updated_at = ?
          WHERE shop_id = ?
            AND status = 'connected'
            AND (reconciliation_lease_until IS NULL
                 OR reconciliation_lease_until < ?)`,
      )
      .run(leaseUntil, now, shopId, now);
    if (changes(claimed) !== 1) return { acquired: false, processed: 0 };
    try {
      const connection = await db
        .prepare(
          `SELECT reconciliation_cursor FROM etsy_connections WHERE shop_id = ?`,
        )
        .get(shopId);
      const cursorMs = connection?.reconciliation_cursor
        ? Date.parse(connection.reconciliation_cursor)
        : Date.now() - 24 * 60 * 60_000;
      const minLastModified = Math.floor(
        (cursorMs - overlapMinutes * 60_000) / 1000,
      );
      let processed = 0;
      let newest = cursorMs;
      let reachedFinalPage = false;
      for (let page = 0; page < maxPages; page += 1) {
        const payload = await etsyClient.listShopReceipts({
          minLastModified,
          limit: pageSize,
          offset: page * pageSize,
        });
        const receipts = Array.isArray(payload?.results)
          ? payload.results
          : Array.isArray(payload)
            ? payload
            : [];
        for (let receipt of receipts) {
          const status = normalizeProviderStatus(receipt);
          if (
            status.includes("refund") &&
            typeof etsyClient.getPaymentByReceiptId === "function"
          ) {
            const payment = await etsyClient.getPaymentByReceiptId(
              receipt.receipt_id,
            );
            receipt = {
              ...receipt,
              payment_adjustments: extractPaymentAdjustments(payment),
            };
          }
          await syncReceipt(receipt, {
            providerEventId: `reconcile:${receipt.receipt_id}:${receipt.update_timestamp || "unknown"}`,
          });
          processed += 1;
          const updatedMs = Date.parse(providerUpdatedAt(receipt));
          if (Number.isFinite(updatedMs)) newest = Math.max(newest, updatedMs);
        }
        if (receipts.length < pageSize) {
          reachedFinalPage = true;
          break;
        }
      }
      if (!reachedFinalPage) {
        throw domainError(
          "ETSY_RECONCILIATION_PAGE_CAP",
          "Receipt reconciliation reached its page cap without a final page.",
        );
      }
      await db
        .prepare(
          `UPDATE etsy_connections
              SET reconciliation_cursor = ?, last_reconciled_at = ?,
                  reconciliation_lease_until = NULL, last_error = NULL,
                  updated_at = ?
            WHERE shop_id = ?`,
        )
        .run(new Date(newest).toISOString(), nowIso(), nowIso(), shopId);
      return { acquired: true, processed };
    } catch (error) {
      await db
        .prepare(
          `UPDATE etsy_connections
              SET reconciliation_lease_until = NULL, last_error = ?,
                  updated_at = ?
            WHERE shop_id = ?`,
        )
        .run(
          String(error?.code || error?.message || "ETSY_RECONCILIATION_FAILED").slice(
            0,
            500,
          ),
          nowIso(),
          shopId,
        );
      throw error;
    }
  }

  async function bindUnitToWebOrder({
    unitId,
    userId,
    webOrderId,
    giftReservationId,
    trackId,
    trackVersionId,
    query,
  }) {
    if (!unitId || !userId || !webOrderId || !query) {
      throw domainError(
        "ETSY_JOURNEY_REQUIRED",
        "A verified Etsy fulfilment journey is required.",
      );
    }
    const selected = rows(
      await query(
        `SELECT * FROM etsy_order_units
          WHERE id = ? AND owner_user_id = ?${db.isPostgres ? " FOR UPDATE" : ""}`,
        [unitId, userId],
      ),
    )[0];
    if (!selected) {
      throw domainError("ETSY_JOURNEY_NOT_FOUND", "Etsy journey was not found.");
    }
    if (selected.web_order_id) {
      if (
        selected.web_order_id === webOrderId &&
        selected.track_id === trackId &&
        selected.track_version_id === trackVersionId
      ) {
        return { unitId: selected.id, idempotent: true };
      }
      throw domainError(
        "ETSY_JOURNEY_ALREADY_USED",
        "That Etsy purchase is already attached to another song.",
      );
    }
    if (selected.state !== "claimed") {
      throw domainError(
        "ETSY_JOURNEY_NOT_CLAIMED",
        "That Etsy purchase is not available for a new song.",
      );
    }
    const updated = await query(
      `UPDATE etsy_order_units
          SET state = 'reserved', web_order_id = ?, gift_reservation_id = ?,
              track_id = ?, track_version_id = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ? AND state = 'claimed'
          AND web_order_id IS NULL`,
      [
        webOrderId,
        giftReservationId,
        trackId,
        trackVersionId,
        nowIso(),
        unitId,
        userId,
      ],
    );
    if (changes(updated) !== 1) {
      throw domainError(
        "ETSY_JOURNEY_CONFLICT",
        "That Etsy purchase changed while the song was being attached.",
      );
    }
    return { unitId, idempotent: false };
  }

  async function findUnitForWebOrder(webOrderId) {
    if (!webOrderId) return null;
    return db
      .prepare(
        `SELECT u.*, o.receipt_id, o.shop_id
           FROM etsy_order_units u
           JOIN etsy_orders o ON o.id = u.etsy_order_id
          WHERE u.web_order_id = ?`,
      )
      .get(webOrderId);
  }

  async function describeUnitForOwner(unitId, userId) {
    if (!unitId || !userId) return null;
    const unit = await db
      .prepare(
        `SELECT u.*, o.receipt_id, t.recipient_name,
                a.status AS artifact_status, a.storage_key, a.sha256,
                a.byte_length, g.share_url
           FROM etsy_order_units u
           JOIN etsy_orders o ON o.id = u.etsy_order_id
           LEFT JOIN tracks t ON t.id = u.track_id
           LEFT JOIN track_artifacts a
             ON a.track_version_id = u.track_version_id
            AND a.kind = 'full_mp3'
           LEFT JOIN gift_orders g
             ON g.sender_user_id = u.owner_user_id
            AND g.content_type = 'song' AND g.content_id = u.track_id
          WHERE u.id = ? AND u.owner_user_id = ?
          ORDER BY g.created_at DESC
          LIMIT 1`,
      )
      .get(unitId, userId);
    if (!unit) return null;
    const artifactReady =
      unit.artifact_status === "ready" &&
      Boolean(unit.storage_key && unit.sha256) &&
      Number(unit.byte_length || 0) >= 1024;
    const refunded = ["canceled", "refunded"].includes(unit.state);
    const delivered = unit.state === "delivered" && artifactReady;
    const rendering = ["reserved", "rendering"].includes(unit.state);
    return {
      etsy_unit_id: unit.id,
      track_version_id: unit.track_version_id || undefined,
      status: refunded
        ? "refunded"
        : delivered
          ? "delivered"
          : rendering
            ? "rendering"
            : "paid",
      content_status: refunded
        ? "refunded"
        : delivered
          ? "ready"
          : rendering
            ? "rendering"
            : "paid",
      delivery_status: delivered ? "ready_to_share" : "not_requested",
      recipient_name: unit.recipient_name || undefined,
      share_url: delivered ? unit.share_url || undefined : undefined,
      order_reference: unit.receipt_id,
      commerce_free: true,
    };
  }

  async function markDeliveredForWebOrder(webOrderId) {
    const unit = await findUnitForWebOrder(webOrderId);
    if (!unit) return { required: false, delivered: false };
    return markDeliveredForUnit(unit.id);
  }

  async function markDeliveredForUnit(unitId) {
    return db.transaction(async (query) => {
      const unit = rows(
        await query(
          `SELECT u.*, o.is_canceled, o.state AS order_state
             FROM etsy_order_units u
             JOIN etsy_orders o ON o.id = u.etsy_order_id
            WHERE u.id = ?${db.isPostgres ? " FOR UPDATE OF u, o" : ""}`,
          [unitId],
        ),
      )[0];
      if (!unit) return { required: false, delivered: false };
      if (
        unit.is_canceled ||
        ["canceled", "refunded", "manual_review"].includes(unit.order_state) ||
        ["canceled", "refunded", "manual_review"].includes(unit.state)
      ) {
        return { required: true, delivered: false, canceled: true };
      }
      const artifact = rows(
        await query(
          `SELECT status, storage_key, sha256, byte_length
             FROM track_artifacts
            WHERE track_version_id = ? AND kind = 'full_mp3'${
              db.isPostgres ? " FOR UPDATE" : ""
            }`,
          [unit.track_version_id],
        ),
      )[0];
      if (
        artifact?.status !== "ready" ||
        !artifact.storage_key ||
        !artifact.sha256 ||
        Number(artifact.byte_length || 0) < 1024
      ) {
        return { required: true, delivered: false, artifact };
      }
      const now = nowIso();
      const updated = await query(
        `UPDATE etsy_order_units
            SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?),
                updated_at = ?
          WHERE id = ? AND state IN ('reserved', 'rendering', 'delivered')`,
        [now, now, unit.id],
      );
      if (changes(updated) !== 1) {
        return { required: true, delivered: false, conflict: true };
      }
      const outstanding = rows(
        await query(
          `SELECT COUNT(*) AS count FROM etsy_order_units
            WHERE etsy_order_id = ?
              AND state NOT IN ('delivered', 'canceled', 'refunded')`,
          [unit.etsy_order_id],
        ),
      )[0];
      if (Number(outstanding?.count || 0) === 0) {
        await query(
          `UPDATE etsy_orders
              SET state = 'fulfilled',
                  fulfilled_at = COALESCE(fulfilled_at, ?), updated_at = ?
            WHERE id = ? AND is_canceled = ${db.isPostgres ? "FALSE" : "0"}
              AND state NOT IN ('canceled', 'refunded', 'manual_review')`,
          [now, now, unit.etsy_order_id],
        );
      }
      await query(
        `INSERT INTO etsy_fulfilment_outbox
          (id, etsy_order_id, etsy_order_unit_id, action, generation, status,
           created_at, updated_at)
         VALUES (?, ?, ?, 'mp3_ready_email', 1, 'pending', ?, ?)
         ON CONFLICT DO NOTHING`,
        [`etsy_outbox_${unit.id}_mp3`, unit.etsy_order_id, unit.id, now, now],
      );
      return { required: true, delivered: true, artifact };
    });
  }

  async function processReadyUnits({ limit = 20 } = {}) {
    const due = await db
      .prepare(
        `SELECT u.id
           FROM etsy_order_units u
           JOIN track_artifacts a
             ON a.track_version_id = u.track_version_id
            AND a.kind = 'full_mp3'
          WHERE u.state IN ('reserved', 'rendering')
            AND a.status = 'ready' AND a.storage_key IS NOT NULL
            AND a.sha256 IS NOT NULL AND a.byte_length >= 1024
          ORDER BY u.updated_at ASC
          LIMIT ?`,
      )
      .all(Math.min(Math.max(Number(limit) || 20, 1), 100));
    const results = [];
    for (const unit of due) {
      results.push(await markDeliveredForUnit(unit.id));
    }
    return results;
  }

  async function processFulfilmentOutbox({
    sendMp3ReadyEmail,
    limit = 10,
  } = {}) {
    if (typeof sendMp3ReadyEmail !== "function") return [];
    const candidates = await db
      .prepare(
        `SELECT id FROM etsy_fulfilment_outbox
          WHERE action = 'mp3_ready_email'
            AND (
              status IN ('pending', 'failed')
              OR (status = 'processing' AND locked_at < ?)
            )
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            AND (locked_at IS NULL OR locked_at < ?)
          ORDER BY created_at ASC
          LIMIT ?`,
      )
      .all(
        new Date(Date.now() - 5 * 60_000).toISOString(),
        nowIso(),
        new Date(Date.now() - 5 * 60_000).toISOString(),
        Math.min(Math.max(Number(limit) || 10, 1), 50),
      );
    const results = [];
    for (const candidate of candidates) {
      const lockedAt = nowIso();
      const claimed = await db
        .prepare(
          `UPDATE etsy_fulfilment_outbox
              SET status = 'processing', locked_at = ?,
                  attempt_count = attempt_count + 1, updated_at = ?
            WHERE id = ?
              AND (
                status IN ('pending', 'failed')
                OR (status = 'processing' AND locked_at < ?)
              )
              AND (locked_at IS NULL OR locked_at < ?)`,
        )
        .run(
          lockedAt,
          lockedAt,
          candidate.id,
          new Date(Date.now() - 5 * 60_000).toISOString(),
          new Date(Date.now() - 5 * 60_000).toISOString(),
        );
      if (changes(claimed) !== 1) continue;
      const row = await db
        .prepare(
          `SELECT x.*, o.buyer_email_encrypted, u.web_order_id, u.track_id,
                  w.email AS web_email, w.share_token_id,
                  t.recipient_name,
                  g.share_url AS gift_share_url
             FROM etsy_fulfilment_outbox x
             JOIN etsy_orders o ON o.id = x.etsy_order_id
             JOIN etsy_order_units u ON u.id = x.etsy_order_unit_id
             LEFT JOIN web_orders w ON w.id = u.web_order_id
             LEFT JOIN tracks t ON t.id = u.track_id
             LEFT JOIN gift_orders g
               ON g.sender_user_id = u.owner_user_id
              AND g.content_type = 'song' AND g.content_id = u.track_id
            WHERE x.id = ?
            ORDER BY g.created_at DESC
            LIMIT 1`,
        )
        .get(candidate.id);
      try {
        const to =
          row?.buyer_email_encrypted
            ? decryptValue(row.buyer_email_encrypted)
            : row?.web_email;
        if (!to) throw domainError("ETSY_BUYER_EMAIL_MISSING", "Buyer email missing.");
        const sent = await sendMp3ReadyEmail({
          to,
          recipientName: row.recipient_name || null,
          shareTokenId: row.share_token_id || null,
          shareUrl: row.gift_share_url || null,
          orderId: row.web_order_id || row.etsy_order_id,
          etsyUnitId: row.etsy_order_unit_id,
          idempotencyKey: `etsy-mp3-ready-${row.etsy_order_unit_id}`,
        });
        const persisted = await db
          .prepare(
            `UPDATE etsy_fulfilment_outbox
                SET status = 'sent', provider_message_id = ?, locked_at = NULL,
                    next_attempt_at = NULL, last_error = NULL, updated_at = ?
              WHERE id = ? AND status = 'processing' AND locked_at = ?`,
          )
          .run(sent?.messageId || null, nowIso(), candidate.id, lockedAt);
        results.push({
          id: candidate.id,
          sent: changes(persisted) === 1,
          staleLease: changes(persisted) !== 1,
        });
      } catch (error) {
        const attempts = Number(row?.attempt_count || 1);
        const terminal = attempts >= 8;
        await db
          .prepare(
            `UPDATE etsy_fulfilment_outbox
                SET status = ?, locked_at = NULL, next_attempt_at = ?,
                    last_error = ?, updated_at = ?
              WHERE id = ? AND status = 'processing' AND locked_at = ?`,
          )
          .run(
            terminal ? "uncertain" : "failed",
            terminal
              ? null
              : new Date(
                  Date.now() +
                    Math.min(60 * 60_000, 60_000 * 2 ** (attempts - 1)),
                ).toISOString(),
            String(error?.code || error?.message || "ETSY_EMAIL_FAILED").slice(
              0,
              500,
            ),
            nowIso(),
            candidate.id,
            lockedAt,
          );
        results.push({ id: candidate.id, sent: false });
      }
    }
    return results;
  }

  async function metrics() {
    const orders = await db
      .prepare(
        `SELECT state, COUNT(*) AS count FROM etsy_orders GROUP BY state`,
      )
      .all();
    const units = await db
      .prepare(
        `SELECT state, COUNT(*) AS count FROM etsy_order_units GROUP BY state`,
      )
      .all();
    const incidents = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM etsy_webhook_events
             WHERE status IN ('failed', 'dead_letter')) AS webhook_failures,
           (SELECT COUNT(*) FROM track_artifacts
             WHERE kind = 'full_mp3' AND status = 'failed') AS mp3_failures`,
      )
      .get();
    const lifecycle = await db
      .prepare(
        `SELECT paid_at, claimed_at, fulfilled_at, canceled_at
           FROM etsy_orders`,
      )
      .all();
    const averageMs = (from, to) => {
      const values = lifecycle
        .filter((row) => row[from] && row[to])
        .map((row) => Date.parse(row[to]) - Date.parse(row[from]))
        .filter((value) => Number.isFinite(value) && value >= 0);
      return values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;
    };
    return {
      orders: Object.fromEntries(orders.map((row) => [row.state, Number(row.count)])),
      units: Object.fromEntries(units.map((row) => [row.state, Number(row.count)])),
      fulfilment: {
        paid_to_claimed_ms: averageMs("paid_at", "claimed_at"),
        paid_to_fulfilled_ms: averageMs("paid_at", "fulfilled_at"),
      },
      incidents: {
        webhook_failures: Number(incidents?.webhook_failures || 0),
        mp3_failures: Number(incidents?.mp3_failures || 0),
      },
    };
  }

  async function findActiveForOwner(userId) {
    if (!userId) return null;
    return db
      .prepare(
        `SELECT o.id AS order_id, o.receipt_id, o.state,
                1 AS unit_count, u.id AS journey_id
           FROM etsy_order_units u
           JOIN etsy_orders o ON o.id = u.etsy_order_id
          WHERE u.owner_user_id = ? AND u.state = 'claimed'
            AND u.gift_reservation_id IS NULL
            AND o.is_canceled = ${db.isPostgres ? "FALSE" : "0"}
          ORDER BY u.claimed_at ASC, u.created_at ASC
          LIMIT 1`,
      )
      .get(userId);
  }

  return {
    ingestPaidReceipt,
    ingestCanceledReceipt,
    syncReceipt,
    refundTransactions,
    claimByVerifiedEmail,
    cancelReceipt,
    recordWebhook,
    processWebhook,
    processPendingWebhooks,
    reconcileReceipts,
    bindUnitToWebOrder,
    findUnitForWebOrder,
    describeUnitForOwner,
    markDeliveredForWebOrder,
    markDeliveredForUnit,
    processReadyUnits,
    processFulfilmentOutbox,
    metrics,
    findActiveForOwner,
  };
}

module.exports = {
  createEtsyOrderService,
  normalizeReceiptId,
};
