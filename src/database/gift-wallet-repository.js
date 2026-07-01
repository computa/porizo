"use strict";

const crypto = require("crypto");
const { nowIso, parseJson, toJson } = require("../utils/common");

const MAX_WALLET_BALANCE = 100000;

function isUniqueConstraintError(err) {
  const code = String(err?.code || "").toUpperCase();
  const message = String(err?.message || "");
  if (code === "23505" || code.includes("SQLITE_CONSTRAINT")) {
    return true;
  }
  return message.includes("UNIQUE") || message.toLowerCase().includes("duplicate");
}

function firstRow(result) {
  return result?.rows?.[0] || null;
}

function affectedRows(result) {
  return result?.rowCount ?? result?.changes ?? 0;
}

function insufficientGiftTokensError() {
  const err = new Error("INSUFFICIENT_GIFT_TOKENS");
  err.code = "INSUFFICIENT_GIFT_TOKENS";
  return err;
}

function createGiftWalletRepository(db) {
  async function ensureRow(userId) {
    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO gift_wallet (user_id, balance, updated_at)
         VALUES (?, 0, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .run(userId, now);

    const wallet = await db
      .prepare(
        "SELECT user_id, balance, updated_at FROM gift_wallet WHERE user_id = ?",
      )
      .get(userId);

    return {
      userId: wallet?.user_id || userId,
      balance: Number(wallet?.balance || 0),
      updatedAt: wallet?.updated_at || now,
    };
  }

  async function getBalance(userId, { query = null } = {}) {
    if (query) {
      const result = await query("SELECT balance FROM gift_wallet WHERE user_id = ?", [
        userId,
      ]);
      return Number(firstRow(result)?.balance || 0);
    }

    const wallet = await db
      .prepare("SELECT balance FROM gift_wallet WHERE user_id = ?")
      .get(userId);
    return Number(wallet?.balance || 0);
  }

  async function hasReceiptCredit({ userId, receiptId }) {
    const row = await db
      .prepare(
        `SELECT id
         FROM gift_wallet_transactions
         WHERE user_id = ?
           AND reference_type = 'receipt'
           AND reference_id = ?
         LIMIT 1`,
      )
      .get(userId, receiptId);
    return Boolean(row);
  }

  async function applyTransaction({
    userId,
    type,
    amount,
    source = null,
    referenceType = null,
    referenceId = null,
    description = null,
    metadata = null,
    idempotencyKey = null,
    externalQuery = null,
  }) {
    const numAmount = Number(amount || 0);
    const timestamp = nowIso();

    const execute = async (query) => {
      await query(
        `INSERT INTO gift_wallet (user_id, balance, updated_at)
         VALUES (?, 0, ?)
         ON CONFLICT(user_id) DO NOTHING`,
        [userId, timestamp],
      );

      if (idempotencyKey) {
        const existingResult = await query(
          `SELECT id, balance_after
           FROM gift_wallet_transactions
           WHERE user_id = ? AND idempotency_key = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId, idempotencyKey],
        );
        const existing = firstRow(existingResult);
        if (existing) {
          return {
            transactionId: existing.id,
            balanceAfter: Number(existing.balance_after || 0),
            idempotent: true,
          };
        }
      }

      let balanceBefore;
      let balanceAfter;

      if (db.isPostgres) {
        const updatedResult = await query(
          "UPDATE gift_wallet SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (balance + ?) >= 0 AND (balance + ?) <= ? RETURNING balance",
          [
            numAmount,
            timestamp,
            userId,
            numAmount,
            numAmount,
            MAX_WALLET_BALANCE,
          ],
        );
        const updated = firstRow(updatedResult);
        if (!updated) {
          throw insufficientGiftTokensError();
        }
        balanceAfter = Number(updated.balance);
        balanceBefore = balanceAfter - numAmount;
      } else {
        const updatedResult = await query(
          "UPDATE gift_wallet SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (balance + ?) >= 0 AND (balance + ?) <= ?",
          [
            numAmount,
            timestamp,
            userId,
            numAmount,
            numAmount,
            MAX_WALLET_BALANCE,
          ],
        );
        if (!affectedRows(updatedResult)) {
          throw insufficientGiftTokensError();
        }
        const walletResult = await query(
          "SELECT balance FROM gift_wallet WHERE user_id = ?",
          [userId],
        );
        balanceAfter = Number(firstRow(walletResult)?.balance || 0);
        balanceBefore = balanceAfter - numAmount;
      }

      const transactionId = `gwtx_${crypto.randomBytes(12).toString("hex")}`;
      try {
        await query(
          `INSERT INTO gift_wallet_transactions (
            id, user_id, type, amount, balance_before, balance_after,
            source, reference_type, reference_id, description, metadata_json, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId,
            userId,
            type,
            numAmount,
            balanceBefore,
            balanceAfter,
            source,
            referenceType,
            referenceId,
            description,
            toJson(metadata || {}),
            idempotencyKey,
            timestamp,
          ],
        );
      } catch (err) {
        if (idempotencyKey && isUniqueConstraintError(err)) {
          const revertResult = await query(
            "UPDATE gift_wallet SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
            [numAmount, timestamp, userId, numAmount],
          );
          if (affectedRows(revertResult) === 0) {
            console.warn("[GiftWallet] Revert skipped after idempotency race", {
              userId,
              amount: numAmount,
            });
          }
          const existingResult = await query(
            `SELECT id, balance_after
             FROM gift_wallet_transactions
             WHERE user_id = ? AND idempotency_key = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [userId, idempotencyKey],
          );
          const existing = firstRow(existingResult);
          if (existing) {
            return {
              transactionId: existing.id,
              balanceAfter: Number(existing.balance_after || 0),
              idempotent: true,
            };
          }
        }
        throw err;
      }

      return { transactionId, balanceAfter, idempotent: false };
    };

    if (externalQuery) {
      return execute(externalQuery);
    }
    return db.transaction(execute);
  }

  async function spendSongTokenInTransaction(query, {
    userId,
    trackId,
    trackVersionId = null,
  }) {
    const updatedResult = await query(
      `UPDATE gift_wallet SET
        balance = balance - 1,
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND balance > 0`,
      [userId],
    );
    if (!affectedRows(updatedResult)) {
      throw insufficientGiftTokensError();
    }

    const afterRes = await query("SELECT balance FROM gift_wallet WHERE user_id = ?", [
      userId,
    ]);
    const balanceAfter = Number(firstRow(afterRes)?.balance ?? 0);
    const balanceBefore = balanceAfter + 1;
    const giftTxId = `gwtx_${crypto.randomBytes(12).toString("hex")}`;

    await query(
      `INSERT INTO gift_wallet_transactions (
        id, user_id, type, amount, balance_before, balance_after,
        source, reference_type, reference_id, description, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        giftTxId,
        userId,
        "song_spend",
        -1,
        balanceBefore,
        balanceAfter,
        "gift_token",
        "track",
        trackId,
        "Song rendered from gift_token",
        null,
        trackVersionId ? `song_spend_${trackVersionId}` : null,
      ],
    );

    return { transactionId: giftTxId, balanceBefore, balanceAfter };
  }

  async function getSummary(userId, limit = 20) {
    const wallet = await ensureRow(userId);
    const rows = await db
      .prepare(
        `SELECT id, type, amount, balance_before, balance_after, source, reference_type, reference_id, description, metadata_json, created_at
         FROM gift_wallet_transactions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(Number(limit) || 20, 100)));

    return {
      balance: wallet.balance,
      updated_at: wallet.updatedAt,
      transactions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: Number(row.amount || 0),
        balance_before: Number(row.balance_before || 0),
        balance_after: Number(row.balance_after || 0),
        source: row.source,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        description: row.description,
        metadata: parseJson(row.metadata_json, {}, `gift_wallet_tx_${row.id}`),
        created_at: row.created_at,
      })),
    };
  }

  return {
    ensureRow,
    getBalance,
    hasReceiptCredit,
    applyTransaction,
    spendSongTokenInTransaction,
    getSummary,
  };
}

module.exports = {
  createGiftWalletRepository,
};
