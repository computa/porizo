"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createAuthRefreshTokenRepository(db) {
  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error(
        "Auth refresh-token repository mutations require database transaction support",
      );
    }
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createAuthRefreshTokenRepository(transactionDb));
    });
  }

  async function insertTokenFamily({ id, userId, sessionId = null }) {
    return db
      .prepare(
        "INSERT INTO token_families (id, user_id, session_id) VALUES (?, ?, ?)",
      )
      .run(id, userId, sessionId);
  }

  async function insertRefreshToken({
    id,
    userId,
    tokenHash,
    tokenFamily,
    generation = 1,
    expiresAt,
  }) {
    return db
      .prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, generation, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, tokenHash, tokenFamily, generation, expiresAt);
  }

  async function findTokenForVerification(tokenHash) {
    return db
      .prepare(
        `SELECT rt.*, tf.compromised_at as family_compromised, tf.session_id,
                us.revoked_at as session_revoked_at,
                us.idle_expires_at as session_idle_expires_at,
                us.absolute_expires_at as session_absolute_expires_at
         FROM refresh_tokens rt
         JOIN token_families tf ON rt.token_family = tf.id
         LEFT JOIN user_sessions us ON tf.session_id = us.id
         WHERE rt.token_hash = ?`,
      )
      .get(tokenHash);
  }

  async function findTokenByHash(tokenHash) {
    return db
      .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
      .get(tokenHash);
  }

  async function findTokenFamilyWithSession(tokenFamily) {
    return db
      .prepare(
        `SELECT tf.*, us.revoked_at as session_revoked_at,
                us.idle_expires_at as session_idle_expires_at,
                us.absolute_expires_at as session_absolute_expires_at
         FROM token_families tf
         LEFT JOIN user_sessions us ON tf.session_id = us.id
         WHERE tf.id = ?`,
      )
      .get(tokenFamily);
  }

  async function findActiveReplacementToken({ tokenFamily, generation }) {
    return db
      .prepare(
        `SELECT id FROM refresh_tokens
         WHERE token_family = ? AND generation = ? AND revoked_at IS NULL`,
      )
      .get(tokenFamily, generation);
  }

  async function revokeToken(tokenId) {
    return db
      .prepare("UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(tokenId);
  }

  async function revokeActiveToken(tokenId) {
    return db
      .prepare(
        "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL",
      )
      .run(tokenId);
  }

  async function clearTokenRevocation(tokenId) {
    return db
      .prepare("UPDATE refresh_tokens SET revoked_at = NULL WHERE id = ?")
      .run(tokenId);
  }

  async function revokeActiveTokensForUser(userId) {
    return db
      .prepare(
        "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
      )
      .run(userId);
  }

  async function compromiseActiveTokenFamiliesForUser(userId) {
    return db
      .prepare(
        "UPDATE token_families SET compromised_at = CURRENT_TIMESTAMP WHERE user_id = ? AND compromised_at IS NULL",
      )
      .run(userId);
  }

  async function compromiseTokenFamily(tokenFamily) {
    return db
      .prepare(
        "UPDATE token_families SET compromised_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(tokenFamily);
  }

  async function revokeTokensInFamily(tokenFamily) {
    return db
      .prepare(
        "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_family = ?",
      )
      .run(tokenFamily);
  }

  async function touchSession({ sessionId, lastActiveAt, idleExpiresAt, lastRotatedAt }) {
    return db
      .prepare(
        `UPDATE user_sessions
         SET last_active_at = ?, idle_expires_at = ?, last_rotated_at = ?
         WHERE id = ? AND revoked_at IS NULL AND absolute_expires_at > ?`,
      )
      .run(lastActiveAt, idleExpiresAt, lastRotatedAt, sessionId, lastActiveAt);
  }

  async function insertGraceUnrevokeAuditLog({
    id,
    userId,
    tokenId,
    tokenFamily,
    generation,
    timeSinceRevocationMs,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        "refresh_token_grace_unrevoke",
        "refresh_token",
        tokenId,
        JSON.stringify({
          severity: "HIGH",
          time_since_revocation_ms: timeSinceRevocationMs,
          has_replacement: false,
          token_family: tokenFamily,
          generation,
        }),
        createdAt,
      );
  }

  return {
    transaction,
    insertTokenFamily,
    insertRefreshToken,
    findTokenForVerification,
    findTokenByHash,
    findTokenFamilyWithSession,
    findActiveReplacementToken,
    revokeToken,
    revokeActiveToken,
    clearTokenRevocation,
    revokeActiveTokensForUser,
    compromiseActiveTokenFamiliesForUser,
    compromiseTokenFamily,
    revokeTokensInFamily,
    touchSession,
    insertGraceUnrevokeAuditLog,
  };
}

module.exports = { createAuthRefreshTokenRepository };
