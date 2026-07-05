"use strict";

function changeCount(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function createAuthSocialChallengeRepository(db) {
  async function insertChallenge({
    id,
    provider,
    nonceHash,
    expiresAt,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO auth_social_challenges (
           id, provider, nonce_hash, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, provider, nonceHash, expiresAt, createdAt);
  }

  async function findUsableChallenge({ id, provider, nonceHash, now }) {
    return db
      .prepare(
        `SELECT *
         FROM auth_social_challenges
         WHERE id = ?
           AND provider = ?
           AND nonce_hash = ?
           AND consumed_at IS NULL
           AND expires_at > ?`,
      )
      .get(id, provider, nonceHash, now);
  }

  async function consumeChallenge({ id, provider, nonceHash, now }) {
    const result = await db
      .prepare(
        `UPDATE auth_social_challenges
         SET consumed_at = ?
         WHERE id = ?
           AND provider = ?
           AND nonce_hash = ?
           AND consumed_at IS NULL
           AND expires_at > ?`,
      )
      .run(now, id, provider, nonceHash, now);

    if (changeCount(result) !== 1) {
      const err = new Error("Social auth challenge not found, expired, or used");
      err.code = "SOCIAL_CHALLENGE_INVALID";
      throw err;
    }

    return db
      .prepare("SELECT * FROM auth_social_challenges WHERE id = ?")
      .get(id);
  }

  async function pruneExpired({ now }) {
    return db
      .prepare(
        `DELETE FROM auth_social_challenges
         WHERE expires_at <= ?
            OR (consumed_at IS NOT NULL AND consumed_at <= ?)`,
      )
      .run(now, now);
  }

  return {
    insertChallenge,
    findUsableChallenge,
    consumeChallenge,
    pruneExpired,
  };
}

module.exports = { createAuthSocialChallengeRepository };
