"use strict";

const TOKEN_TABLES = {
  password_reset: "password_reset_tokens",
  email_verification: "email_verification_tokens",
};

function changeCount(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function getTokenTable(tokenType) {
  const tableName = TOKEN_TABLES[tokenType];
  if (!tableName) {
    throw new Error(`Invalid token type: ${tokenType}`);
  }
  return tableName;
}

function createAuthOneTimeTokenRepository(db) {
  async function insertPasswordResetToken({
    id,
    userId,
    tokenHash,
    expiresAt,
  }) {
    return db
      .prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, userId, tokenHash, expiresAt);
  }

  async function insertEmailVerificationToken({
    id,
    userId,
    tokenHash,
    expiresAt,
    emailNormalized = null,
  }) {
    return db
      .prepare(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, email_normalized)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, userId, tokenHash, expiresAt, emailNormalized);
  }

  async function consumeOneTimeToken({ tokenType, tokenHash }) {
    const tableName = getTokenTable(tokenType);

    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE ${tableName}
         SET used_at = CURRENT_TIMESTAMP
         WHERE token_hash = ?
           AND used_at IS NULL
           AND expires_at >= ?`,
      )
      .run(tokenHash, now);

    if (changeCount(result) !== 1) {
      const existing = await db
        .prepare(`SELECT used_at, expires_at FROM ${tableName} WHERE token_hash = ?`)
        .get(tokenHash);

      if (!existing) {
        throw new Error("Token not found or invalid");
      }
      if (existing.used_at) {
        throw new Error("Token has already been used");
      }
      if (new Date(existing.expires_at) < new Date(now)) {
        throw new Error("Token has expired");
      }
      throw new Error("Token could not be consumed");
    }

    const token = await db
      .prepare(`SELECT * FROM ${tableName} WHERE token_hash = ?`)
      .get(tokenHash);

    if (!token) {
      throw new Error("Token not found or invalid");
    }

    return token;
  }

  async function markTokenUsed({ tokenType, tokenId }) {
    const tableName = getTokenTable(tokenType);
    return db
      .prepare(`UPDATE ${tableName} SET used_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(tokenId);
  }

  async function invalidateActiveTokensForUser({ tokenType, userId }) {
    const tableName = getTokenTable(tokenType);
    return db
      .prepare(
        `UPDATE ${tableName} SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL`,
      )
      .run(userId);
  }

  return {
    insertPasswordResetToken,
    insertEmailVerificationToken,
    consumeOneTimeToken,
    markTokenUsed,
    invalidateActiveTokensForUser,
  };
}

module.exports = { createAuthOneTimeTokenRepository };
