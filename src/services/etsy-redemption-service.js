"use strict";

const crypto = require("crypto");
const { nowIso } = require("../utils/common");

// No 0/O/1/I: buyers type these codes from a printed order insert.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_FORMAT = /^PZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
// Mirrors the CHECK constraint in migration 136 (both engines). If a status is
// added there, add it here — countByStatus seeds its breakdown from this list.
const CODE_STATUSES = ["unredeemed", "redeemed", "void"];

function randomGroup(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function generateCode() {
  return `PZ-${randomGroup(4)}-${randomGroup(4)}`;
}

function normalizeCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function affectedRows(result) {
  return result?.rowCount ?? result?.changes ?? 0;
}

function redemptionError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/**
 * One-time Etsy redemption codes (plan 2026-07-21-001 §0.7.5). Each code
 * grants exactly one gift-wallet credit; the existing gift_credit order path
 * spends it. Concurrency guard is the atomic claim UPDATE (WHERE status =
 * 'unredeemed') — one winner; the wallet idempotency key makes the winner's
 * grant replay-safe, so a redeem retry can never mint a second credit.
 */
function createEtsyRedemptionService({ db, giftWalletRepository }) {
  async function mintBatch({ batchLabel, count }) {
    const label = String(batchLabel || "").trim();
    const total = Number(count);
    if (!label)
      throw redemptionError("BATCH_LABEL_REQUIRED", "batchLabel is required.");
    if (!Number.isInteger(total) || total < 1 || total > 1000) {
      throw redemptionError("INVALID_BATCH_COUNT", "count must be 1-1000.");
    }
    const now = nowIso();
    // All-or-nothing batch: a partial mint would leave orphan codes with no
    // record of what was actually issued. The collision catch sits OUTSIDE the
    // transaction on purpose — Postgres aborts the whole transaction on a
    // unique violation, so a per-row catch-and-retry inside it would die with
    // "current transaction is aborted". On the ~1-in-32^8 PK collision with an
    // existing row, the rolled-back batch is retried wholesale.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const seen = new Set();
      while (seen.size < total) seen.add(generateCode());
      const codes = [...seen];
      try {
        await db.transaction(async (query) => {
          for (const code of codes) {
            await query(
              `INSERT INTO etsy_redemption_codes (code, batch_label, status, created_at)
               VALUES (?, ?, 'unredeemed', ?)`,
              [code, label, now],
            );
          }
        });
        return codes;
      } catch (err) {
        const msg = String(err?.message || "");
        if (!/unique|constraint|duplicate/i.test(msg)) throw err;
      }
    }
    throw redemptionError("CODE_MINT_FAILED", "Could not mint a unique batch.");
  }

  async function validate(rawCode) {
    const code = normalizeCode(rawCode);
    if (!CODE_FORMAT.test(code)) return { valid: false, status: "not_found" };
    const row = await db
      .prepare("SELECT status FROM etsy_redemption_codes WHERE code = ?")
      .get(code);
    if (!row) return { valid: false, status: "not_found" };
    return { valid: row.status === "unredeemed", status: row.status };
  }

  // CONTRACT: userId must reference an EXISTING, committed users row.
  // redeemed_by_user_id carries an FK to users(id) (enforced on both engines —
  // sqlite runs PRAGMA foreign_keys ON), so calling this with a not-yet-
  // provisioned guest throws a raw FK error instead of a domain error. Routes
  // must resolve/provision the (guest) user BEFORE calling redeem.
  async function redeem({ code: rawCode, userId, externalQuery = null }) {
    const code = normalizeCode(rawCode);
    if (!userId) throw redemptionError("USER_REQUIRED", "userId is required.");
    if (!CODE_FORMAT.test(code)) {
      throw redemptionError("CODE_NOT_FOUND", "That code isn't recognised.");
    }
    const execute = async (query) => {
      const now = nowIso();
      const claim = await query(
        `UPDATE etsy_redemption_codes
         SET status = 'redeemed', redeemed_by_user_id = ?, redeemed_at = ?
         WHERE code = ? AND status = 'unredeemed'`,
        [userId, now, code],
      );
      let idempotentRetry = false;
      if (affectedRows(claim) === 0) {
        const rowResult = await query(
          "SELECT status, redeemed_by_user_id FROM etsy_redemption_codes WHERE code = ?",
          [code],
        );
        const row = rowResult?.rows?.[0] ?? rowResult?.[0] ?? rowResult;
        if (!row || !row.status) {
          throw redemptionError(
            "CODE_NOT_FOUND",
            "That code isn't recognised.",
          );
        }
        if (row.status === "void") {
          throw redemptionError("CODE_VOID", "That code is no longer valid.");
        }
        if (row.redeemed_by_user_id !== userId) {
          throw redemptionError(
            "CODE_ALREADY_REDEEMED",
            "That code has already been used.",
          );
        }
        idempotentRetry = true;
      }
      // Wallet idempotency key is the code itself: the grant happens at most
      // once no matter how many times the same buyer retries.
      const grant = await giftWalletRepository.applyTransaction({
        userId,
        type: "etsy_code_redemption",
        amount: 1,
        source: "etsy",
        referenceType: "etsy_code",
        referenceId: code,
        description: "Etsy order redemption",
        idempotencyKey: `etsy_code:${code}`,
        externalQuery: query,
      });
      await query(
        `UPDATE etsy_redemption_codes
         SET grant_transaction_id = ?
         WHERE code = ? AND grant_transaction_id IS NULL`,
        [grant.transactionId, code],
      );
      await query(
        `UPDATE etsy_code_assignments
         SET state = 'redeemed', updated_at = ?
         WHERE code = ? AND state IN ('assigned', 'delivered')`,
        [now, code],
      );
      return {
        redeemed: true,
        idempotent: idempotentRetry || grant.idempotent === true,
        code,
        balance_after: grant.balanceAfter,
      };
    };
    return externalQuery ? execute(externalQuery) : db.transaction(execute);
  }

  async function issueForReceipt({
    receiptId,
    listingId = null,
    batchLabel,
    adminId,
  }) {
    const receipt = String(receiptId || "").trim();
    const label = String(batchLabel || "").trim();
    const operator = String(adminId || "").trim();
    if (!receipt) {
      throw redemptionError("RECEIPT_ID_REQUIRED", "receiptId is required.");
    }
    if (!label) {
      throw redemptionError("BATCH_LABEL_REQUIRED", "batchLabel is required.");
    }
    if (!operator) {
      throw redemptionError("ADMIN_ID_REQUIRED", "adminId is required.");
    }

    const existing = await db
      .prepare(
        `SELECT c.code, a.state
         FROM etsy_code_assignments a
         JOIN etsy_redemption_codes c ON c.code = a.code
         WHERE a.receipt_id = ?`,
      )
      .get(receipt);
    if (existing) {
      throw redemptionError(
        "RECEIPT_ALREADY_ASSIGNED",
        "That Etsy receipt already has an assigned code.",
      );
    }

    const now = nowIso();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateCode();
      try {
        await db.transaction(async (query) => {
          await query(
            `INSERT INTO etsy_redemption_codes
              (code, batch_label, status, created_at)
             VALUES (?, ?, 'unredeemed', ?)`,
            [code, label, now],
          );
          await query(
            `INSERT INTO etsy_code_assignments (
              code, receipt_id, listing_id, state, assigned_by_admin_id,
              assigned_at, updated_at
            ) VALUES (?, ?, ?, 'assigned', ?, ?, ?)`,
            [
              code,
              receipt,
              listingId ? String(listingId).trim() : null,
              operator,
              now,
              now,
            ],
          );
        });
        return { code, receiptId: receipt, state: "assigned" };
      } catch (error) {
        const message = String(error?.message || "");
        if (/receipt_id/i.test(message)) {
          throw redemptionError(
            "RECEIPT_ALREADY_ASSIGNED",
            "That Etsy receipt already has an assigned code.",
          );
        }
        if (!/unique|duplicate/i.test(message)) throw error;
      }
    }
    throw redemptionError("CODE_MINT_FAILED", "Could not issue a unique code.");
  }

  async function markDelivered({ receiptId, deliveryReference }) {
    const receipt = String(receiptId || "").trim();
    const reference = String(deliveryReference || "").trim();
    if (!receipt) {
      throw redemptionError("RECEIPT_ID_REQUIRED", "receiptId is required.");
    }
    if (!reference) {
      throw redemptionError(
        "DELIVERY_REFERENCE_REQUIRED",
        "deliveryReference is required.",
      );
    }
    const now = nowIso();
    const result = await db
      .prepare(
        `UPDATE etsy_code_assignments
         SET state = CASE WHEN state = 'assigned' THEN 'delivered' ELSE state END,
             delivery_reference = ?, delivered_at = COALESCE(delivered_at, ?),
             updated_at = ?
         WHERE receipt_id = ? AND state IN ('assigned', 'delivered')`,
      )
      .run(reference, now, now, receipt);
    if (!affectedRows(result)) {
      throw redemptionError(
        "ASSIGNMENT_NOT_DELIVERABLE",
        "No deliverable code assignment was found for that receipt.",
      );
    }
    return { receiptId: receipt, state: "delivered" };
  }

  async function revealAssignedCode({ receiptId }) {
    const receipt = String(receiptId || "").trim();
    if (!receipt) {
      throw redemptionError("RECEIPT_ID_REQUIRED", "receiptId is required.");
    }
    const row = await db
      .prepare(
        `SELECT code, state
         FROM etsy_code_assignments
         WHERE receipt_id = ?`,
      )
      .get(receipt);
    if (!row || row.state !== "assigned") {
      throw redemptionError(
        "ASSIGNMENT_NOT_REVEALABLE",
        "Only an undelivered assignment can be revealed.",
      );
    }
    return { code: row.code, receiptId: receipt, state: row.state };
  }

  async function reverseAssignment({
    receiptId,
    refundEvidence,
    reason = null,
  }) {
    const receipt = String(receiptId || "").trim();
    const evidence = String(refundEvidence || "").trim();
    if (!receipt) {
      throw redemptionError("RECEIPT_ID_REQUIRED", "receiptId is required.");
    }
    if (!evidence) {
      throw redemptionError(
        "ETSY_REFUND_EVIDENCE_REQUIRED",
        "refundEvidence is required.",
      );
    }
    return db.transaction(async (query) => {
      const result = await query(
        `SELECT a.code, a.state, c.status, c.redeemed_by_user_id,
                c.grant_transaction_id
         FROM etsy_code_assignments a
         JOIN etsy_redemption_codes c ON c.code = a.code
         WHERE a.receipt_id = ?${db.isPostgres ? " FOR UPDATE" : ""}`,
        [receipt],
      );
      const row = result?.rows?.[0] ?? result?.[0] ?? result;
      if (!row?.code) {
        throw redemptionError(
          "ASSIGNMENT_NOT_FOUND",
          "No code assignment was found for that receipt.",
        );
      }
      if (row.state === "refunded") {
        return {
          receiptId: receipt,
          state: "refunded",
          entitlementReversed: true,
          idempotent: true,
        };
      }

      const now = nowIso();
      let entitlementReversed = false;
      let state = "refunded";
      if (row.status === "unredeemed") {
        await query(
          `UPDATE etsy_redemption_codes
           SET status = 'void', void_reason = ?
           WHERE code = ? AND status = 'unredeemed'`,
          [reason || "Etsy order refunded", row.code],
        );
        entitlementReversed = true;
      } else if (
        row.status === "redeemed" &&
        row.redeemed_by_user_id &&
        row.grant_transaction_id
      ) {
        const balanceResult = await query(
          "SELECT balance FROM gift_wallet WHERE user_id = ?",
          [row.redeemed_by_user_id],
        );
        const wallet =
          balanceResult?.rows?.[0] ?? balanceResult?.[0] ?? balanceResult;
        if (Number(wallet?.balance || 0) >= 1) {
          await giftWalletRepository.applyPurchaseReversal({
            userId: row.redeemed_by_user_id,
            purchaseTransactionId: row.grant_transaction_id,
            amount: -1,
            type: "purchase_reversal",
            source: "etsy",
            referenceType: "purchase_transaction",
            referenceId: row.grant_transaction_id,
            metadata: { receipt_id: receipt, reason },
            idempotencyKey: `etsy_code_refund:${receipt}:${evidence}`,
            externalQuery: query,
          });
          entitlementReversed = true;
        } else {
          state = "manual_review";
        }
      } else {
        state = "manual_review";
      }

      await query(
        `UPDATE etsy_code_assignments
         SET state = ?, refund_evidence = ?,
             refunded_at = CASE
               WHEN ? = 'refunded' THEN COALESCE(refunded_at, ?)
               ELSE refunded_at
             END,
             updated_at = ?
         WHERE receipt_id = ?`,
        [state, evidence, state, now, now, receipt],
      );
      return {
        receiptId: receipt,
        state,
        entitlementReversed,
        idempotent: false,
      };
    });
  }

  // Gate A instrumentation: the operator filters by batch (and optionally
  // status) to read out issued/redeemed/unredeemed. `counts` is always the
  // per-status breakdown for the whole batch, independent of the row `status`
  // filter — that breakdown IS the Gate A number, so a status filter must not
  // change it.
  async function listCodes({
    batchLabel = null,
    status = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const clauses = [];
    const params = [];
    if (batchLabel) {
      clauses.push("batch_label = ?");
      params.push(String(batchLabel).trim());
    }
    if (status) {
      clauses.push("status = ?");
      params.push(String(status).trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const cappedLimit = Math.max(1, Math.min(1000, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = await db
      .prepare(
        `SELECT c.code, c.batch_label, c.status, c.redeemed_at, c.created_at,
                a.receipt_id, a.listing_id, a.state AS delivery_state,
                a.assigned_at, a.delivered_at
         FROM etsy_redemption_codes c
         LEFT JOIN etsy_code_assignments a ON a.code = c.code
         ${where}
         ORDER BY c.created_at DESC, c.code ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, cappedLimit, safeOffset);
    return {
      codes: rows.map(({ code, ...row }) => ({
        ...row,
        code_last4: String(code || "").slice(-4),
      })),
      limit: cappedLimit,
      offset: safeOffset,
    };
  }

  async function countByStatus({ batchLabel = null } = {}) {
    const params = [];
    let where = "";
    if (batchLabel) {
      where = "WHERE batch_label = ?";
      params.push(String(batchLabel).trim());
    }
    const rows = await db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM etsy_redemption_codes
         ${where}
         GROUP BY status`,
      )
      .all(...params);
    // Seeded from CODE_STATUSES so a future status can never be silently
    // dropped from the Gate A breakdown — an unknown status in the table is
    // a bug worth surfacing, not filtering.
    const counts = Object.fromEntries(CODE_STATUSES.map((s) => [s, 0]));
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  async function voidCode({ code: rawCode, reason = null }) {
    const code = normalizeCode(rawCode);
    const result = await db
      .prepare(
        `UPDATE etsy_redemption_codes
         SET status = 'void', void_reason = ?
         WHERE code = ? AND status = 'unredeemed'`,
      )
      .run(reason, code);
    if (affectedRows(result) === 0) {
      throw redemptionError(
        "CODE_NOT_VOIDABLE",
        "Only an unredeemed code can be voided.",
      );
    }
    await db
      .prepare(
        `UPDATE etsy_code_assignments
         SET state = 'canceled', updated_at = ?
         WHERE code = ? AND state IN ('assigned', 'delivered')`,
      )
      .run(nowIso(), code);
    return { voided: true, code };
  }

  return {
    mintBatch,
    issueForReceipt,
    markDelivered,
    revealAssignedCode,
    reverseAssignment,
    validate,
    redeem,
    voidCode,
    listCodes,
    countByStatus,
  };
}

module.exports = { createEtsyRedemptionService, normalizeCode };
