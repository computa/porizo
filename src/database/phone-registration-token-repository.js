"use strict";

function createPhoneRegistrationTokenRepository(db) {
  async function deleteAll() {
    return db.prepare("DELETE FROM phone_registration_tokens").run();
  }

  async function insert({
    tokenHash,
    phoneNumberHash,
    ipAddress = null,
    verifiedAt,
    expiresAt,
  }) {
    return db
      .prepare(
        `INSERT INTO phone_registration_tokens (token_hash, phone_number_hash, ip_address, verified_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tokenHash, phoneNumberHash, ipAddress, verifiedAt, expiresAt);
  }

  async function consume({ tokenHash, phoneNumberHash, ipAddress = null }) {
    return db
      .prepare(
        `UPDATE phone_registration_tokens
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE token_hash = ?
           AND consumed_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
           AND phone_number_hash = ?
           AND (ip_address = ? OR ip_address IS NULL)`,
      )
      .run(tokenHash, phoneNumberHash, ipAddress);
  }

  async function deleteExpired() {
    return db
      .prepare("DELETE FROM phone_registration_tokens WHERE expires_at < CURRENT_TIMESTAMP")
      .run();
  }

  async function findRecentVerification({
    phoneNumberHash,
    verifiedAfter,
    ipAddress = null,
  }) {
    return db
      .prepare(
        `SELECT token_hash FROM phone_registration_tokens
         WHERE phone_number_hash = ? AND verified_at > ?
           AND (ip_address = ? OR ip_address IS NULL)
         ORDER BY verified_at DESC LIMIT 1`,
      )
      .get(phoneNumberHash, verifiedAfter, ipAddress);
  }

  return {
    isPhoneRegistrationTokenRepository: true,
    deleteAll,
    insert,
    consume,
    deleteExpired,
    findRecentVerification,
  };
}

module.exports = {
  createPhoneRegistrationTokenRepository,
};
