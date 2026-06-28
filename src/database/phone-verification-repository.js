"use strict";

function createPhoneVerificationRepository(db) {
  async function countRecentCodes({ phoneNumber, createdAfter }) {
    return db
      .prepare(
        `SELECT COUNT(*) as count FROM phone_verifications
         WHERE phone_number = ? AND created_at > ?`,
      )
      .get(phoneNumber, createdAfter);
  }

  async function getOldestRecentCode({ phoneNumber, createdAfter }) {
    return db
      .prepare(
        `SELECT created_at FROM phone_verifications
         WHERE phone_number = ? AND created_at > ?
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(phoneNumber, createdAfter);
  }

  async function markActiveCodesVerified({ phoneNumber }) {
    return db
      .prepare(
        `UPDATE phone_verifications
         SET verified_at = CURRENT_TIMESTAMP
         WHERE phone_number = ? AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      )
      .run(phoneNumber);
  }

  async function insertVerification({ id, phoneNumber, codeHash, expiresAt }) {
    return db
      .prepare(
        `INSERT INTO phone_verifications (id, phone_number, code_hash, expires_at, attempts)
         VALUES (?, ?, ?, ?, 0)`,
      )
      .run(id, phoneNumber, codeHash, expiresAt);
  }

  async function getLatestActiveVerification({ phoneNumber }) {
    return db
      .prepare(
        `SELECT id, code_hash, attempts FROM phone_verifications
         WHERE phone_number = ? AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(phoneNumber);
  }

  async function markVerified({ id }) {
    return db
      .prepare("UPDATE phone_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id);
  }

  async function incrementAttempts({ id }) {
    return db
      .prepare("UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?")
      .run(id);
  }

  async function getLatestActiveAttempts({ phoneNumber }) {
    return db
      .prepare(
        `SELECT attempts FROM phone_verifications
         WHERE phone_number = ? AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(phoneNumber);
  }

  async function deleteCreatedBefore({ createdBefore }) {
    return db
      .prepare("DELETE FROM phone_verifications WHERE created_at < ?")
      .run(createdBefore);
  }

  return {
    countRecentCodes,
    getOldestRecentCode,
    markActiveCodesVerified,
    insertVerification,
    getLatestActiveVerification,
    markVerified,
    incrementAttempts,
    getLatestActiveAttempts,
    deleteCreatedBefore,
  };
}

module.exports = {
  createPhoneVerificationRepository,
};
