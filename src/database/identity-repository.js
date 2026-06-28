"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createIdentityRepository(db) {
  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error("Identity repository mutations require database transaction support");
    }
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createIdentityRepository(transactionDb));
    });
  }

  async function findActiveIdentity(provider, providerUserId) {
    return db.prepare(
      `SELECT uap.id, uap.user_id, uap.provider, uap.provider_user_id,
              uap.provider_data, uap.verified_at, uap.linked_at, uap.last_used_at, uap.status
         FROM user_auth_providers uap
         JOIN users u ON u.id = uap.user_id AND u.deleted_at IS NULL
        WHERE uap.provider = ? AND uap.provider_user_id = ? AND uap.status = 'active'`,
    ).get(provider, providerUserId);
  }

  async function findUserDisplayProfile(userId) {
    return db.prepare(
      "SELECT display_name, email FROM users WHERE id = ?",
    ).get(userId);
  }

  async function findActiveUserByVerifiedContact(type, valueNormalized) {
    return db.prepare(
      `SELECT uc.user_id AS id FROM user_contacts uc
       JOIN users u ON u.id = uc.user_id AND u.deleted_at IS NULL
       WHERE uc.type = ? AND uc.value_normalized = ? AND uc.verified_at IS NOT NULL
       LIMIT 1`,
    ).get(type, valueNormalized);
  }

  async function findActiveUserByProvider(provider, providerUserId, options = {}) {
    const status = options.status ?? null;
    return db.prepare(
      `SELECT uap.user_id AS id FROM user_auth_providers uap
       JOIN users u ON u.id = uap.user_id AND u.deleted_at IS NULL
       WHERE uap.provider = ? AND uap.provider_user_id = ?
         AND (? IS NULL OR uap.status = ?)
       LIMIT 1`,
    ).get(provider, providerUserId, status, status);
  }

  async function listAuthProvidersForUser(userId) {
    return db.prepare(
      "SELECT provider FROM user_auth_providers WHERE user_id = ?",
    ).all(userId);
  }

  async function findMostRecentActiveIdentityForUser(userId) {
    return db.prepare(
      `SELECT id FROM user_auth_providers
       WHERE user_id = ? AND status = 'active'
       ORDER BY last_used_at DESC LIMIT 1`,
    ).get(userId);
  }

  async function findUserContactMirrors(userId) {
    return db.prepare(
      "SELECT email, phone_number FROM users WHERE id = ?",
    ).get(userId);
  }

  async function deleteUserIdentityBootstrapRows(userId) {
    if (typeof db.transaction === "function") {
      return transaction((txRepository) =>
        txRepository.deleteUserIdentityBootstrapRows(userId),
      );
    }
    await db.prepare("DELETE FROM user_contacts WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_auth_providers WHERE user_id = ?").run(userId);
    return db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }

  async function insertUser({
    id,
    displayName = null,
    avatarUrl = null,
    locale = null,
    country = null,
    createdAt,
  }) {
    return db.prepare(
      `INSERT INTO users (id, display_name, avatar_url, locale, country, risk_level, created_at)
       VALUES (?, ?, ?, ?, ?, 'low', ?)`,
    ).run(id, displayName, avatarUrl, locale, country, createdAt);
  }

  async function insertAuthProvider({
    id,
    userId,
    provider,
    providerUserId,
    providerDataJson = null,
    verifiedAt,
    linkedAt,
    lastUsedAt,
  }) {
    return db.prepare(
      `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, provider_data, verified_at, linked_at, last_used_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    ).run(
      id,
      userId,
      provider,
      providerUserId,
      providerDataJson,
      verifiedAt,
      linkedAt,
      lastUsedAt,
    );
  }

  async function findContactByValue(userId, type, valueNormalized) {
    return db.prepare(
      "SELECT id, verified_at FROM user_contacts WHERE user_id = ? AND type = ? AND value_normalized = ?",
    ).get(userId, type, valueNormalized);
  }

  async function updateContactVerificationSource({
    id,
    source,
    sourceIdentityId = null,
    verifiedAt,
  }) {
    return db.prepare(
      "UPDATE user_contacts SET source = ?, source_identity_id = ?, verified_at = ? WHERE id = ?",
    ).run(source, sourceIdentityId, verifiedAt, id);
  }

  async function updateContactSource({ id, source, sourceIdentityId = null }) {
    return db.prepare(
      "UPDATE user_contacts SET source = ?, source_identity_id = ? WHERE id = ?",
    ).run(source, sourceIdentityId, id);
  }

  async function findAnyContactOfType(userId, type) {
    return db.prepare(
      "SELECT id FROM user_contacts WHERE user_id = ? AND type = ? LIMIT 1",
    ).get(userId, type);
  }

  async function insertContact({
    id,
    userId,
    type,
    valueNormalized,
    valueDisplay,
    verifiedAt = null,
    source,
    sourceIdentityId = null,
    isPrimary,
    isRelay,
    createdAt,
  }) {
    return db.prepare(
      `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, source_identity_id, is_primary, is_relay, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      type,
      valueNormalized,
      valueDisplay,
      verifiedAt,
      source,
      sourceIdentityId,
      isPrimary ? 1 : 0,
      isRelay ? 1 : 0,
      createdAt,
    );
  }

  async function verifyExistingUnverifiedContact({
    userId,
    type,
    valueNormalized,
    verifiedAt,
    source,
  }) {
    return db.prepare(
      `UPDATE user_contacts SET verified_at = ?, source = ?
       WHERE user_id = ? AND type = ? AND value_normalized = ? AND verified_at IS NULL`,
    ).run(verifiedAt, source, userId, type, valueNormalized);
  }

  async function getContactTypeForUser(contactId, userId) {
    return db.prepare(
      "SELECT type FROM user_contacts WHERE id = ? AND user_id = ?",
    ).get(contactId, userId);
  }

  async function clearPrimaryContactForType(userId, type) {
    return db.prepare(
      "UPDATE user_contacts SET is_primary = false WHERE user_id = ? AND type = ? AND is_primary = true",
    ).run(userId, type);
  }

  async function setPrimaryContact(contactId) {
    return db.prepare(
      "UPDATE user_contacts SET is_primary = true WHERE id = ?",
    ).run(contactId);
  }

  async function findVerifiedNonRelayEmail(userId) {
    return db.prepare(
      `SELECT id FROM user_contacts
       WHERE user_id = ? AND type = 'email' AND verified_at IS NOT NULL AND is_relay = false
       LIMIT 1`,
    ).get(userId);
  }

  async function findNonRelayEmail(userId) {
    return db.prepare(
      `SELECT id FROM user_contacts
       WHERE user_id = ? AND type = 'email' AND is_relay = false
       LIMIT 1`,
    ).get(userId);
  }

  async function findVerifiedPhone(userId) {
    return db.prepare(
      `SELECT id FROM user_contacts
       WHERE user_id = ? AND type = 'phone' AND verified_at IS NOT NULL
       LIMIT 1`,
    ).get(userId);
  }

  async function findPhone(userId) {
    return db.prepare(
      `SELECT id FROM user_contacts
       WHERE user_id = ? AND type = 'phone'
       LIMIT 1`,
    ).get(userId);
  }

  async function findPrimaryVerifiedEmail(userId) {
    return db.prepare(
      `SELECT value_normalized FROM user_contacts
       WHERE user_id = ? AND type = 'email' AND is_primary = true AND verified_at IS NOT NULL
       LIMIT 1`,
    ).get(userId);
  }

  async function findPrimaryVerifiedPhone(userId) {
    return db.prepare(
      `SELECT value_normalized FROM user_contacts
       WHERE user_id = ? AND type = 'phone' AND is_primary = true AND verified_at IS NOT NULL
       LIMIT 1`,
    ).get(userId);
  }

  async function updateUserContactMirrors({ userId, email, emailVerified, phoneNumber }) {
    return db.prepare(
      "UPDATE users SET email = ?, email_verified = ?, phone_number = ? WHERE id = ?",
    ).run(email, emailVerified, phoneNumber, userId);
  }

  async function updateIdentityLastUsed(identityId, lastUsedAt) {
    return db.prepare(
      "UPDATE user_auth_providers SET last_used_at = ? WHERE id = ?",
    ).run(lastUsedAt, identityId);
  }

  async function findIdentityConflict(provider, providerUserId, excludeUserId = null) {
    return db.prepare(
      `SELECT user_id FROM user_auth_providers
       WHERE provider = ? AND provider_user_id = ? AND status = 'active'
         AND (? IS NULL OR user_id != ?)`,
    ).get(provider, providerUserId, excludeUserId, excludeUserId);
  }

  async function findVerifiedContactConflict(type, valueNormalized, excludeUserId = null) {
    return db.prepare(
      `SELECT user_id FROM user_contacts
       WHERE type = ? AND value_normalized = ? AND verified_at IS NOT NULL
         AND (? IS NULL OR user_id != ?)`,
    ).get(type, valueNormalized, excludeUserId, excludeUserId);
  }

  return {
    isIdentityRepository: true,
    transaction,
    findActiveIdentity,
    findUserDisplayProfile,
    findActiveUserByVerifiedContact,
    findActiveUserByProvider,
    listAuthProvidersForUser,
    findMostRecentActiveIdentityForUser,
    findUserContactMirrors,
    deleteUserIdentityBootstrapRows,
    insertUser,
    insertAuthProvider,
    findContactByValue,
    updateContactVerificationSource,
    updateContactSource,
    findAnyContactOfType,
    insertContact,
    verifyExistingUnverifiedContact,
    getContactTypeForUser,
    clearPrimaryContactForType,
    setPrimaryContact,
    findVerifiedNonRelayEmail,
    findNonRelayEmail,
    findVerifiedPhone,
    findPhone,
    findPrimaryVerifiedEmail,
    findPrimaryVerifiedPhone,
    updateUserContactMirrors,
    updateIdentityLastUsed,
    findIdentityConflict,
    findVerifiedContactConflict,
  };
}

module.exports = { createIdentityRepository };
