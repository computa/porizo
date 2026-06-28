"use strict";

function createAuthProviderLinkingRepository(db) {
  async function findAnyProviderLink(provider, providerUserId) {
    return db
      .prepare(
        `SELECT user_id, status
           FROM user_auth_providers
          WHERE provider = ? AND provider_user_id = ?
          LIMIT 1`,
      )
      .get(provider, providerUserId);
  }

  async function findProviderForDeletedUser(provider, providerUserId) {
    return db
      .prepare(
        `SELECT uap.id
           FROM user_auth_providers uap
           JOIN users u ON u.id = uap.user_id
          WHERE uap.provider = ?
            AND uap.provider_user_id = ?
            AND u.deleted_at IS NOT NULL
          LIMIT 1`,
      )
      .get(provider, providerUserId);
  }

  async function revokeProvider(providerId) {
    return db
      .prepare("UPDATE user_auth_providers SET status = 'revoked' WHERE id = ?")
      .run(providerId);
  }

  async function updateProviderData(providerId, providerData) {
    const providerDataJson =
      typeof providerData === "string"
        ? providerData
        : JSON.stringify(providerData ?? {});

    return db
      .prepare("UPDATE user_auth_providers SET provider_data = ? WHERE id = ?")
      .run(providerDataJson, providerId);
  }

  return {
    isAuthProviderLinkingRepository: true,
    findAnyProviderLink,
    findProviderForDeletedUser,
    revokeProvider,
    updateProviderData,
  };
}

module.exports = { createAuthProviderLinkingRepository };
