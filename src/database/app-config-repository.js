"use strict";

function createAppConfigRepository(db) {
  async function findConfigValue(key) {
    return db
      .prepare("SELECT value_json, updated_at, updated_by FROM app_config WHERE key = ?")
      .get(key);
  }

  async function upsertConfigValue({ key, valueJson, updatedAt, updatedBy }) {
    return db
      .prepare(
        `INSERT INTO app_config (key, value_json, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by`,
      )
      .run(key, valueJson, updatedAt, updatedBy);
  }

  async function listProviderStatusByNameLike(nameLike) {
    return db
      .prepare("SELECT provider_name, status FROM provider_status WHERE provider_name LIKE ?")
      .all(nameLike);
  }

  async function listActiveGiftBundles() {
    return db
      .prepare(
        "SELECT product_id, token_count, display_name, sort_order FROM gift_bundles WHERE is_active = 1 ORDER BY sort_order",
      )
      .all();
  }

  async function findActiveOnboardingSample() {
    return db
      .prepare(
        "SELECT label, audio_url FROM onboarding_samples WHERE is_active = 1 LIMIT 1",
      )
      .get();
  }

  async function findSecurityConfig(id = "default") {
    return db.prepare("SELECT * FROM security_config WHERE id = ?").get(id);
  }

  async function upsertSecurityConfig({
    sessionDurationHours,
    maxFailedLoginAttempts,
    lockoutDurationMinutes,
    rateLimitDefaultsJson,
    iosMinSupportedVersion,
    iosRecommendedVersion,
    iosUpdateMessage,
    iosAutoRecommendedVersion,
    iosLastAppStoreVersion,
    iosLastAppStoreSyncAt,
    iosAppStoreSyncError,
    updatedAt,
    updatedBy,
  }) {
    return db
      .prepare(
        `INSERT INTO security_config (
          id,
          session_duration_hours,
          max_failed_logins,
          lockout_minutes,
          rate_limit_defaults_json,
          ios_min_supported_version,
          ios_recommended_version,
          ios_update_message,
          ios_auto_recommended_version,
          ios_last_app_store_version,
          ios_last_app_store_sync_at,
          ios_app_store_sync_error,
          updated_at,
          updated_by
        )
        VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_duration_hours = excluded.session_duration_hours,
          max_failed_logins = excluded.max_failed_logins,
          lockout_minutes = excluded.lockout_minutes,
          rate_limit_defaults_json = excluded.rate_limit_defaults_json,
          ios_min_supported_version = excluded.ios_min_supported_version,
          ios_recommended_version = excluded.ios_recommended_version,
          ios_update_message = excluded.ios_update_message,
          ios_auto_recommended_version = excluded.ios_auto_recommended_version,
          ios_last_app_store_version = excluded.ios_last_app_store_version,
          ios_last_app_store_sync_at = excluded.ios_last_app_store_sync_at,
          ios_app_store_sync_error = excluded.ios_app_store_sync_error,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by`,
      )
      .run(
        sessionDurationHours,
        maxFailedLoginAttempts,
        lockoutDurationMinutes,
        rateLimitDefaultsJson,
        iosMinSupportedVersion,
        iosRecommendedVersion,
        iosUpdateMessage,
        iosAutoRecommendedVersion,
        iosLastAppStoreVersion,
        iosLastAppStoreSyncAt,
        iosAppStoreSyncError,
        updatedAt,
        updatedBy,
      );
  }

  return {
    findConfigValue,
    upsertConfigValue,
    listProviderStatusByNameLike,
    listActiveGiftBundles,
    findActiveOnboardingSample,
    findSecurityConfig,
    upsertSecurityConfig,
  };
}

module.exports = {
  createAppConfigRepository,
};
