"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

const ACCOUNT_DELETION_LOCK_TABLES = [
  "story_sessions",
  "story_turns",
  "tracks",
  "track_versions",
  "jobs",
  "share_tokens",
  "share_access_log",
  "track_library_entries",
  "poems",
  "poem_share_tokens",
  "poem_share_access_log",
  "poem_library_entries",
  "gift_orders",
  "gift_delivery_outbox",
  "gift_dispatch_attempts",
  "gift_delivery_incidents",
  "gift_reservations",
  "gift_wallet_transactions",
  "gift_wallet",
  "credit_transactions",
  "song_transactions",
  "purchase_receipts",
  "subscriptions",
  "webhook_notifications",
  "entitlements",
  "devices",
  "apple_ads_attribution",
  "download_events",
  "events",
  "receiver_sessions",
  "receiver_session_events",
  "receiver_claim_tokens",
  "enrollment_sessions",
  "voice_profiles",
  "voice_provider_profiles",
  "voice_provider_jobs",
  "rate_limits",
  "auth_events",
  "email_verification_tokens",
  "password_reset_tokens",
  "refresh_tokens",
  "token_families",
  "user_sessions",
  "granted_identities",
  "user_auth_providers",
  "user_credentials",
  "user_contacts",
  "audit_logs",
];

function createAccountDeletionRepository(db) {
  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error("Account deletion requires database transaction support");
    }
    return db.transaction(async (query) => {
      const transactionDb = createPreparedDbFromQuery(query, db);
      return callback(createAccountDeletionRepository(transactionDb), transactionDb);
    });
  }

  async function findActiveUser(userId) {
    return db
      .prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL")
      .get(userId);
  }

  async function lockUserScopedTablesForAccountDeletion() {
    if (!db.isPostgres) {
      return { changes: 0 };
    }
    return db
      .prepare(
        `LOCK TABLE ${ACCOUNT_DELETION_LOCK_TABLES.join(", ")}
         IN SHARE ROW EXCLUSIVE MODE`,
      )
      .run();
  }

  async function getDeletionTombstoneContext(userId) {
    const providers = await db
      .prepare(
        "SELECT provider, provider_user_id FROM user_auth_providers WHERE user_id = ?",
      )
      .all(userId);
    const trialRow = await db
      .prepare("SELECT trial_started_at FROM entitlements WHERE user_id = ?")
      .get(userId);

    return {
      providers,
      hadTrial: !!trialRow?.trial_started_at,
    };
  }

  async function deleteStoryRowsForUser(userId) {
    await db
      .prepare(
        `DELETE FROM story_turns WHERE session_id IN
         (SELECT id FROM story_sessions WHERE user_id = ?)`,
      )
      .run(userId);
    await db.prepare("DELETE FROM story_sessions WHERE user_id = ?").run(userId);
  }

  async function deleteShareRowsForUser(userId) {
    await db
      .prepare(
        `DELETE FROM share_access_log WHERE share_token_id IN
         (SELECT id FROM share_tokens WHERE bound_user_id = ?)`,
      )
      .run(userId);
    await db
      .prepare(
        `DELETE FROM track_library_entries
         WHERE user_id = ?
            OR track_id IN (SELECT id FROM tracks WHERE user_id = ?)`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `DELETE FROM share_access_log WHERE share_token_id IN
         (SELECT id FROM share_tokens
          WHERE creator_id = ?
             OR track_id IN (SELECT id FROM tracks WHERE user_id = ?))`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `DELETE FROM share_tokens
         WHERE creator_id = ?
            OR track_id IN (SELECT id FROM tracks WHERE user_id = ?)`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `UPDATE share_tokens SET
           bound_user_id = NULL,
           bound_device_id = NULL,
           bound_device_platform = NULL,
           bound_app_version = NULL,
           bound_at = NULL
         WHERE bound_user_id = ?`,
      )
      .run(userId);
  }

  async function deleteTrackRowsForUser(userId) {
    await db
      .prepare(
        `DELETE FROM jobs WHERE track_version_id IN
         (SELECT id FROM track_versions WHERE track_id IN
          (SELECT id FROM tracks WHERE user_id = ?))`,
      )
      .run(userId);
    await db
      .prepare(
        `DELETE FROM track_versions WHERE track_id IN
         (SELECT id FROM tracks WHERE user_id = ?)`,
      )
      .run(userId);
    await db.prepare("DELETE FROM tracks WHERE user_id = ?").run(userId);
  }

  async function deletePoemRowsForUser(userId) {
    await db
      .prepare(
        `DELETE FROM poem_share_access_log WHERE poem_share_token_id IN
         (SELECT id FROM poem_share_tokens WHERE bound_user_id = ?)`,
      )
      .run(userId);
    await db
      .prepare(
        `DELETE FROM poem_library_entries
         WHERE user_id = ?
            OR poem_id IN (SELECT id FROM poems WHERE user_id = ?)`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `DELETE FROM poem_share_access_log WHERE poem_share_token_id IN
         (SELECT id FROM poem_share_tokens
          WHERE creator_id = ?
             OR poem_id IN (SELECT id FROM poems WHERE user_id = ?))`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `DELETE FROM poem_share_tokens
         WHERE creator_id = ?
            OR poem_id IN (SELECT id FROM poems WHERE user_id = ?)`,
      )
      .run(userId, userId);
    await db
      .prepare(
        `UPDATE poem_share_tokens SET
           bound_user_id = NULL,
           bound_at = NULL
         WHERE bound_user_id = ?`,
      )
      .run(userId);
    return db.prepare("DELETE FROM poems WHERE user_id = ?").run(userId);
  }

  async function deleteBillingRowsForUser(userId) {
    await db.prepare("DELETE FROM credit_transactions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM song_transactions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM purchase_receipts WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM subscriptions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM webhook_notifications WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM entitlements WHERE user_id = ?").run(userId);
  }

  async function deleteGiftRowsForUser(userId) {
    await db
      .prepare(
        `DELETE FROM gift_delivery_incidents WHERE gift_order_id IN
         (SELECT id FROM gift_orders WHERE sender_user_id = ?)`,
      )
      .run(userId);
    await db
      .prepare(
        `DELETE FROM gift_delivery_outbox WHERE gift_order_id IN
         (SELECT id FROM gift_orders WHERE sender_user_id = ?)`,
      )
      .run(userId);
    await db
      .prepare(
        `DELETE FROM gift_dispatch_attempts WHERE gift_order_id IN
         (SELECT id FROM gift_orders WHERE sender_user_id = ?)`,
      )
      .run(userId);
    await db.prepare("DELETE FROM gift_orders WHERE sender_user_id = ?").run(userId);
    await db.prepare("DELETE FROM gift_reservations WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM gift_wallet_transactions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM gift_wallet WHERE user_id = ?").run(userId);
  }

  async function scrubTelemetryAndAttributionRowsForUser(userId) {
    await db
      .prepare(
        `UPDATE events SET
           user_id = NULL,
           ip_address = NULL,
           user_agent = NULL
         WHERE user_id = ?`,
      )
      .run(userId);
    await db.prepare("DELETE FROM devices WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM apple_ads_attribution WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM download_events WHERE matched_user_id = ?").run(userId);
    await db
      .prepare(
        `DELETE FROM receiver_claim_tokens WHERE receiver_session_id IN
         (SELECT id FROM receiver_sessions WHERE matched_user_id = ?)`,
      )
      .run(userId);
    await db
      .prepare(
        `UPDATE receiver_session_events SET
           metadata_json = NULL,
           ip_address = NULL,
           user_agent = NULL
         WHERE receiver_session_id IN
           (SELECT id FROM receiver_sessions WHERE matched_user_id = ?)`,
      )
      .run(userId);
    await db
      .prepare(
        `UPDATE receiver_sessions SET
           receiver_session_secret_hash = NULL,
           receiver_claim_token_hash = NULL,
           claim_token_expires_at = NULL,
           first_ip_address = NULL,
           last_ip_address = NULL,
           first_user_agent = NULL,
           last_user_agent = NULL,
           appsflyer_click_id = NULL,
           matched_user_id = NULL
         WHERE matched_user_id = ?`,
      )
      .run(userId);
  }

  async function insertVoiceProviderProfilesDeletedAudit({
    id,
    userId,
    providerProfiles,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO audit_logs (
           id, user_id, action, resource_type, resource_id, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        "voice_provider_profiles_deleted",
        "user",
        userId,
        JSON.stringify({
          reason: "account_deletion",
          provider_profiles_deleted: providerProfiles.map((row) => ({
            id: row.id,
            voice_profile_id: row.voice_profile_id,
            provider: row.provider,
            status: row.status,
          })),
        }),
        createdAt,
      );
  }

  async function deleteEnrollmentAndVoiceRowsForUser(userId) {
    await db.prepare("DELETE FROM enrollment_sessions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM voice_profiles WHERE user_id = ?").run(userId);
  }

  async function deleteRateLimitRowsForUser(userId) {
    return db.prepare("DELETE FROM rate_limits WHERE user_id = ?").run(userId);
  }

  async function anonymizeAuthEventsForUser(userId) {
    return db
      .prepare(
        `UPDATE auth_events SET
           ip_address = NULL,
           user_agent = NULL,
           metadata = NULL
         WHERE user_id = ?`,
      )
      .run(userId);
  }

  async function anonymizeAuditLogsForUser(userId) {
    return db
      .prepare(
        `UPDATE audit_logs SET
           resource_id = CASE WHEN resource_id = ? THEN NULL ELSE resource_id END,
           metadata_json = NULL
         WHERE user_id = ?`,
      )
      .run(userId, userId);
  }

  async function deleteAuthTokenAndSessionRowsForUser(userId) {
    await db
      .prepare("DELETE FROM email_verification_tokens WHERE user_id = ?")
      .run(userId);
    await db
      .prepare("DELETE FROM password_reset_tokens WHERE user_id = ?")
      .run(userId);
    await db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM token_families WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
  }

  async function insertGrantedIdentityTombstones({ identityHashes, hadTrial }) {
    for (const hash of identityHashes) {
      await db
        .prepare(
          `INSERT INTO granted_identities (identity_hash, grant_kind)
           VALUES (?, 'signup')
           ON CONFLICT (identity_hash, grant_kind) DO NOTHING`,
        )
        .run(hash);
      if (hadTrial) {
        await db
          .prepare(
            `INSERT INTO granted_identities (identity_hash, grant_kind)
             VALUES (?, 'trial')
             ON CONFLICT (identity_hash, grant_kind) DO NOTHING`,
          )
          .run(hash);
      }
    }
  }

  async function deleteAuthProviderAndCredentialRowsForUser(userId) {
    await db.prepare("DELETE FROM user_auth_providers WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(userId);
  }

  async function deleteContactRowsForUser(userId) {
    return db.prepare("DELETE FROM user_contacts WHERE user_id = ?").run(userId);
  }

  async function softDeleteUser({ userId, deletedAt }) {
    return db
      .prepare(
        `UPDATE users SET
           email = 'deleted_' || id || '@deleted.local',
           email_verified = 0,
           display_name = 'Deleted User',
           avatar_url = NULL,
           phone_number = NULL,
           phone_verified_at = NULL,
           username = NULL,
           locale = NULL,
           country = NULL,
           acquisition_source = NULL,
           acquisition_campaign = NULL,
           acquisition_country = NULL,
           acquisition_medium = NULL,
           acquisition_content = NULL,
           acquisition_term = NULL,
           acquisition_referrer = NULL,
           acquisition_at = NULL,
           onesignal_synced_at = NULL,
           profile_completion_skipped_at = NULL,
           unsubscribed_at = NULL,
           deleted_at = ?
         WHERE id = ?`,
      )
      .run(deletedAt, userId);
  }

  async function insertAccountDeletedAuthEvent({ id, userId }) {
    return db
      .prepare(
        `INSERT INTO auth_events (id, user_id, event_type, ip_address, user_agent, metadata)
         VALUES (?, ?, 'account_deleted', NULL, NULL, NULL)`,
      )
      .run(id, userId);
  }

  return {
    transaction,
    findActiveUser,
    lockUserScopedTablesForAccountDeletion,
    getDeletionTombstoneContext,
    deleteStoryRowsForUser,
    deleteShareRowsForUser,
    deleteTrackRowsForUser,
    deletePoemRowsForUser,
    deleteBillingRowsForUser,
    deleteGiftRowsForUser,
    scrubTelemetryAndAttributionRowsForUser,
    insertVoiceProviderProfilesDeletedAudit,
    deleteEnrollmentAndVoiceRowsForUser,
    deleteRateLimitRowsForUser,
    anonymizeAuthEventsForUser,
    anonymizeAuditLogsForUser,
    deleteAuthTokenAndSessionRowsForUser,
    insertGrantedIdentityTombstones,
    deleteAuthProviderAndCredentialRowsForUser,
    deleteContactRowsForUser,
    softDeleteUser,
    insertAccountDeletedAuthEvent,
  };
}

module.exports = {
  createAccountDeletionRepository,
};
