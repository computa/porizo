"use strict";

const {
  createPreparedDbFromQuery,
  dbGet,
  dbRun,
} = require("../utils/db-adapter");

function mapTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    purpose: row.purpose,
    emailNormalized: row.email_normalized,
    accountId: row.account_id,
    authorizingSessionId: row.authorizing_session_id,
    linkSecretHash: row.link_secret_hash,
    requestSecretHash: row.request_secret_hash,
    requesterKeyHash: row.requester_key_hash,
    ipAddressHash: row.ip_address_hash,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
    consumedAt: row.consumed_at,
    sessionId: row.session_id,
    recoveryRequestHash: row.recovery_request_hash,
    recoveryResult: parseRecoveryResult(row.recovery_result_json),
    recoveryExpiresAt: row.recovery_expires_at,
    recoveryClaimedAt: row.recovery_claimed_at,
  };
}

function parseRecoveryResult(value) {
  if (value == null || typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createMagicLoginRepository(db) {
  async function insert(transaction) {
    return dbRun(
      db,
      `INSERT INTO magic_login_transactions (
         id, platform, purpose, email_normalized, account_id,
         authorizing_session_id,
         link_secret_hash, request_secret_hash, requester_key_hash,
         ip_address_hash, max_attempts, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transaction.id,
        transaction.platform,
        transaction.purpose,
        transaction.emailNormalized,
        transaction.accountId,
        transaction.authorizingSessionId,
        transaction.linkSecretHash,
        transaction.requestSecretHash,
        transaction.requesterKeyHash,
        transaction.ipAddressHash,
        transaction.maxAttempts,
        transaction.createdAt,
        transaction.expiresAt,
      ],
    );
  }

  async function findById(id) {
    return mapTransaction(
      await dbGet(db, "SELECT * FROM magic_login_transactions WHERE id = ?", [id]),
    );
  }

  async function claimPending({
    id,
    platform,
    linkSecretHash,
    requestSecretHash,
    consumedAt,
  }) {
    const result = await dbRun(
      db,
      `UPDATE magic_login_transactions
          SET status = 'consumed', consumed_at = ?
        WHERE id = ? AND platform = ? AND status = 'pending'
          AND expires_at > ? AND attempt_count < max_attempts
          AND link_secret_hash = ? AND request_secret_hash = ?`,
      [
        consumedAt,
        id,
        platform,
        consumedAt,
        linkSecretHash,
        requestSecretHash,
      ],
    );
    return result.changes === 1;
  }

  async function approvePending({ id, platform, linkSecretHash, approvedAt }) {
    const result = await dbRun(
      db,
      `UPDATE magic_login_transactions
          SET approved_at = COALESCE(approved_at, ?)
        WHERE id = ? AND platform = ? AND status = 'pending'
          AND expires_at > ? AND attempt_count < max_attempts
          AND link_secret_hash = ?`,
      [approvedAt, id, platform, approvedAt, linkSecretHash],
    );
    return result.changes === 1;
  }

  async function findByRequesterProof({ id, platform, requestSecretHash }) {
    return mapTransaction(
      await dbGet(
        db,
        `SELECT * FROM magic_login_transactions
          WHERE id = ? AND platform = ? AND request_secret_hash = ?`,
        [id, platform, requestSecretHash],
      ),
    );
  }

  async function claimApproved({ id, platform, requestSecretHash, consumedAt }) {
    const result = await dbRun(
      db,
      `UPDATE magic_login_transactions
          SET status = 'consumed', consumed_at = ?
        WHERE id = ? AND platform = ? AND status = 'pending'
          AND approved_at IS NOT NULL AND expires_at > ?
          AND attempt_count < max_attempts AND request_secret_hash = ?`,
      [consumedAt, id, platform, consumedAt, requestSecretHash],
    );
    return result.changes === 1;
  }

  async function recordFailedAttempt({ id, platform, attemptedAt }) {
    return dbRun(
      db,
      `UPDATE magic_login_transactions
          SET attempt_count = attempt_count + 1,
              status = CASE
                WHEN attempt_count + 1 >= max_attempts THEN 'locked'
                ELSE status
              END
        WHERE id = ? AND platform = ? AND status = 'pending'
          AND expires_at > ?`,
      [id, platform, attemptedAt],
    );
  }

  async function storeRecoveryResult({
    id,
    requestSecretHash,
    result,
    recoveryExpiresAt,
    sessionId = null,
  }) {
    return dbRun(
      db,
      `UPDATE magic_login_transactions
          SET recovery_request_hash = ?, recovery_result_json = ?,
              recovery_expires_at = ?, session_id = ?
        WHERE id = ? AND status = 'consumed' AND recovery_result_json IS NULL`,
      [
        requestSecretHash,
        JSON.stringify(result),
        recoveryExpiresAt,
        sessionId,
        id,
      ],
    );
  }

  async function claimRecovery({
    id,
    platform,
    linkSecretHash,
    requestSecretHash,
    claimedAt,
  }) {
    return mapTransaction(
      await dbGet(
        db,
        `SELECT * FROM magic_login_transactions
          WHERE id = ? AND platform = ? AND status = 'consumed'
            AND link_secret_hash = ? AND recovery_request_hash = ?
            AND recovery_result_json IS NOT NULL
            AND recovery_expires_at > ?`,
        [id, platform, linkSecretHash, requestSecretHash, claimedAt],
      ),
    );
  }

  async function claimNativeRecovery({ id, platform, requestSecretHash, claimedAt }) {
    return mapTransaction(
      await dbGet(
        db,
        `SELECT * FROM magic_login_transactions
          WHERE id = ? AND platform = ? AND status = 'consumed'
            AND recovery_request_hash = ? AND recovery_result_json IS NOT NULL
            AND recovery_expires_at > ?`,
        [id, platform, requestSecretHash, claimedAt],
      ),
    );
  }

  async function countActive(filters, at) {
    const allowed = {
      emailNormalized: "email_normalized",
      accountId: "account_id",
      requesterKeyHash: "requester_key_hash",
      ipAddressHash: "ip_address_hash",
      platform: "platform",
    };
    const clauses = ["status = 'pending'", "expires_at > ?"];
    const params = [at];
    for (const [key, value] of Object.entries(filters || {})) {
      if (value == null || !allowed[key]) continue;
      clauses.push(`${allowed[key]} = ?`);
      params.push(value);
    }
    const row = await dbGet(
      db,
      `SELECT COUNT(*) AS count FROM magic_login_transactions WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return Number(row?.count || 0);
  }

  async function findRecentActive(filters) {
    const allowed = {
      emailNormalized: "email_normalized",
      requesterKeyHash: "requester_key_hash",
      ipAddressHash: "ip_address_hash",
    };
    const clauses = ["status = 'pending'", "created_at >= ?"];
    const params = [filters.since];
    for (const [key, column] of Object.entries(allowed)) {
      if (filters[key] == null) continue;
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
    return mapTransaction(
      await dbGet(
        db,
        `SELECT * FROM magic_login_transactions
          WHERE ${clauses.join(" AND ")}
          ORDER BY created_at DESC LIMIT 1`,
        params,
      ),
    );
  }

  async function cleanupExpired(at) {
    const marked = await dbRun(
      db,
      `UPDATE magic_login_transactions SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= ?`,
      [at],
    );
    await dbRun(
      db,
      `DELETE FROM magic_login_transactions
        WHERE status != 'pending'
          AND COALESCE(recovery_expires_at, expires_at) < ?`,
      [at],
    );
    return marked.changes;
  }

  async function expirePendingAddEmailForSession({ sessionId, expiredAt }) {
    return dbRun(
      db,
      `UPDATE magic_login_transactions
          SET status = 'expired', expires_at = ?
        WHERE purpose = 'add_email' AND status = 'pending'
          AND authorizing_session_id = ?`,
      [expiredAt, sessionId],
    );
  }

  async function expirePendingAddEmailForAccount({ accountId, expiredAt }) {
    return dbRun(
      db,
      `UPDATE magic_login_transactions
          SET status = 'expired', expires_at = ?
        WHERE purpose = 'add_email' AND status = 'pending'
          AND account_id = ?`,
      [expiredAt, accountId],
    );
  }

  async function withTransaction(callback) {
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createMagicLoginRepository(transactionDb));
    });
  }

  return {
    db,
    insert,
    findById,
    claimPending,
    approvePending,
    findByRequesterProof,
    claimApproved,
    recordFailedAttempt,
    storeRecoveryResult,
    claimRecovery,
    claimNativeRecovery,
    countActive,
    findRecentActive,
    cleanupExpired,
    expirePendingAddEmailForSession,
    expirePendingAddEmailForAccount,
    withTransaction,
  };
}

module.exports = { createMagicLoginRepository };
