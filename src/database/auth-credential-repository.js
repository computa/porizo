"use strict";

function createAuthCredentialRepository(db) {
  async function createPasswordCredential({ userId, passwordHash, createdAt }) {
    return db
      .prepare(
        `INSERT INTO user_credentials (user_id, password_hash, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(userId, passwordHash, createdAt);
  }

  async function findPasswordCredential(userId) {
    return db
      .prepare("SELECT password_hash FROM user_credentials WHERE user_id = ?")
      .get(userId);
  }

  async function updatePasswordCredential(userId, passwordHash) {
    return db
      .prepare(
        "UPDATE user_credentials SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE user_id = ?",
      )
      .run(passwordHash, userId);
  }

  return {
    isAuthCredentialRepository: true,
    createPasswordCredential,
    findPasswordCredential,
    updatePasswordCredential,
  };
}

module.exports = {
  createAuthCredentialRepository,
};
