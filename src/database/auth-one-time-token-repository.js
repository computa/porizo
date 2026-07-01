"use strict";

const TOKEN_TABLES = {
  password_reset: "password_reset_tokens",
  email_verification: "email_verification_tokens",
};

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

    return db.transaction(async () => {
      const token = await db
        .prepare(`SELECT * FROM ${tableName} WHERE token_hash = ?`)
        .get(tokenHash);

      if (!token) {
        throw new Error("Token not found or invalid");
      }

      if (token.used_at) {
        throw new Error("Token has already been used");
      }

      if (new Date(token.expires_at) < new Date()) {
        throw new Error("Token has expired");
      }

      await db
        .prepare(
          `UPDATE ${tableName} SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL`,
        )
        .run(token.id);

      return token;
    });
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
