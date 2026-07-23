"use strict";

const crypto = require("node:crypto");
const { normalizeCode } = require("./etsy-redemption-service");
const { nowIso } = require("../utils/common");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function claimError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw claimError("INVALID_EMAIL", "Enter a valid email address.");
  }
  return email;
}

function createEtsyCodeClaimService({ db, now = nowIso } = {}) {
  if (!db) throw new Error("ETSY_CODE_CLAIM_DB_REQUIRED");

  async function assertRedeemable(rawCode) {
    const code = normalizeCode(rawCode);
    const row = await db
      .prepare("SELECT status FROM etsy_redemption_codes WHERE code = ?")
      .get(code);
    if (!row) throw claimError("CODE_NOT_FOUND", "That code isn't recognised.");
    if (row.status === "void") {
      throw claimError("CODE_VOID", "That code is no longer valid.");
    }
    if (row.status !== "unredeemed") {
      throw claimError(
        "CODE_ALREADY_REDEEMED",
        "That code has already been used.",
      );
    }
    return code;
  }

  async function createPending({
    code: rawCode,
    email,
    magicTransactionId,
    expiresAt,
  }) {
    const code = await assertRedeemable(rawCode);
    const emailNormalized = normalizeEmail(email);
    const createdAt = now();
    if (
      !magicTransactionId ||
      !expiresAt ||
      Date.parse(expiresAt) <= Date.parse(createdAt)
    ) {
      throw claimError("INVALID_CODE_CLAIM", "Invalid code claim.");
    }
    await db
      .prepare(
        `UPDATE etsy_code_claims
            SET status = 'expired'
          WHERE code = ? AND status = 'pending' AND expires_at <= ?`,
      )
      .run(code, createdAt);
    try {
      const id = `etsy_claim_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO etsy_code_claims
            (id, magic_transaction_id, code, email_normalized, status,
             expires_at, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          id,
          magicTransactionId,
          code,
          emailNormalized,
          expiresAt,
          createdAt,
        );
      return { id, emailNormalized, expiresAt };
    } catch (error) {
      const databaseCode = String(error?.code || "").toUpperCase();
      if (
        databaseCode === "23505" ||
        databaseCode.includes("SQLITE_CONSTRAINT_UNIQUE") ||
        /unique|duplicate/i.test(String(error?.message || ""))
      ) {
        throw claimError(
          "CODE_CLAIM_PENDING",
          "A verification email was already sent for this code.",
        );
      }
      throw error;
    }
  }

  async function findPendingForTransaction(
    magicTransactionId,
    { query = null, at = now() } = {},
  ) {
    const sql = `SELECT id, code, email_normalized, expires_at
                   FROM etsy_code_claims
                  WHERE magic_transaction_id = ? AND status = 'pending'
                    AND expires_at > ?`;
    if (query) {
      const result = await query(sql, [magicTransactionId, at]);
      return result?.rows?.[0] || null;
    }
    return db.prepare(sql).get(magicTransactionId, at);
  }

  async function expirePendingForTransaction(magicTransactionId) {
    return db
      .prepare(
        `UPDATE etsy_code_claims
         SET status = 'expired'
         WHERE magic_transaction_id = ? AND status = 'pending'`,
      )
      .run(magicTransactionId);
  }

  async function markConsumed(
    { claimId, ownerUserId },
    { query, consumedAt = now() },
  ) {
    const result = await query(
      `UPDATE etsy_code_claims
          SET status = 'consumed', owner_user_id = ?, consumed_at = ?
        WHERE id = ? AND status = 'pending' AND expires_at > ?`,
      [ownerUserId, consumedAt, claimId, consumedAt],
    );
    const changed = result?.rowCount ?? result?.changes ?? 0;
    if (changed !== 1) {
      throw claimError("CODE_CLAIM_EXPIRED", "This verification has expired.");
    }
  }

  return {
    assertRedeemable,
    createPending,
    findPendingForTransaction,
    expirePendingForTransaction,
    markConsumed,
  };
}

module.exports = {
  createEtsyCodeClaimService,
  normalizeEmail,
};
