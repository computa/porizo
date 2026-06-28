"use strict";

function createAuthProfileRepository(db) {
  async function findUserEmail(userId) {
    return db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  }

  async function findActiveUserProfile(userId) {
    return db
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.avatar_url, u.email_verified,
                u.phone_number, u.username, u.created_at, u.profile_completion_skipped_at
         FROM users u
         WHERE u.id = ?
           AND u.deleted_at IS NULL`,
      )
      .get(userId);
  }

  async function listActiveAuthProviders(userId) {
    return db
      .prepare(
        `SELECT provider, provider_user_id, linked_at, last_used_at
         FROM user_auth_providers WHERE user_id = ? AND status = 'active'`,
      )
      .all(userId);
  }

  async function listContacts(userId) {
    return db
      .prepare(
        `SELECT id, type, value_normalized, value_display, verified_at, is_primary, is_relay
         FROM user_contacts WHERE user_id = ?`,
      )
      .all(userId);
  }

  async function findVerifiedEmailOwner({ emailNormalized, excludeUserId = null }) {
    return db
      .prepare(
        `SELECT uc.user_id as id FROM user_contacts uc
         WHERE uc.type = 'email'
           AND uc.value_normalized = ?
           AND uc.verified_at IS NOT NULL
           AND (? IS NULL OR uc.user_id != ?)
         LIMIT 1`,
      )
      .get(emailNormalized, excludeUserId, excludeUserId);
  }

  async function updateDisplayName(userId, displayName) {
    return db
      .prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .run(displayName, userId);
  }

  async function markProfileCompletionSkipped(userId) {
    return db
      .prepare(
        "UPDATE users SET profile_completion_skipped_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(userId);
  }

  async function findLinkedPhoneForUser({ userId, phoneNumber }) {
    return db
      .prepare(
        `SELECT id FROM user_auth_providers
         WHERE user_id = ? AND provider = 'phone' AND provider_user_id = ?`,
      )
      .get(userId, phoneNumber);
  }

  async function findLatestUnverifiedEmail(userId) {
    return db
      .prepare(
        `SELECT value_normalized FROM user_contacts
         WHERE user_id = ? AND type = 'email' AND verified_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId);
  }

  async function findActiveUserByUsername(username) {
    return db
      .prepare("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL")
      .get(username);
  }

  return {
    isAuthProfileRepository: true,
    findUserEmail,
    findActiveUserProfile,
    listActiveAuthProviders,
    listContacts,
    findVerifiedEmailOwner,
    updateDisplayName,
    markProfileCompletionSkipped,
    findLinkedPhoneForUser,
    findLatestUnverifiedEmail,
    findActiveUserByUsername,
  };
}

module.exports = {
  createAuthProfileRepository,
};
