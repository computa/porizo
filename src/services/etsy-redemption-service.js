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
  async function redeem({ code: rawCode, userId }) {
    const code = normalizeCode(rawCode);
    if (!userId) throw redemptionError("USER_REQUIRED", "userId is required.");
    if (!CODE_FORMAT.test(code)) {
      throw redemptionError("CODE_NOT_FOUND", "That code isn't recognised.");
    }
    return db.transaction(async (query) => {
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
      return {
        redeemed: true,
        idempotent: idempotentRetry || grant.idempotent === true,
        code,
        balance_after: grant.balanceAfter,
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
        `SELECT code, batch_label, status, redeemed_by_user_id, redeemed_at, created_at
         FROM etsy_redemption_codes
         ${where}
         ORDER BY created_at DESC, code ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, cappedLimit, safeOffset);
    return {
      codes: rows,
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
    return { voided: true, code };
  }

  return { mintBatch, validate, redeem, voidCode, listCodes, countByStatus };
}

module.exports = { createEtsyRedemptionService };
