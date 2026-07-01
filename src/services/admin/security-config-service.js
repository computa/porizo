"use strict";

const defaultConfig = require("../../config");

const DEFAULT_RATE_LIMITS = {
  enrollment_start: { limit: 3, windowSeconds: 86400 },
  render_preview: { limit: 20, windowSeconds: 86400 },
  track_create: { limit: 20, windowSeconds: 3600 },
};

function createDefaultSecurityConfig() {
  const rateLimitDefaults = Object.fromEntries(
    Object.entries(DEFAULT_RATE_LIMITS).map(([key, value]) => [
      key,
      { ...value },
    ]),
  );

  return {
    sessionDurationHours: 8,
    maxFailedLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    rateLimitDefaults,
    iosMinSupportedVersion: "",
    iosRecommendedVersion: "",
    iosUpdateMessage: "",
    iosAutoRecommendedVersion: false,
    iosLastAppStoreVersion: "",
    iosLastAppStoreSyncAt: "",
    iosAppStoreSyncError: "",
  };
}

function mapSecurityConfigRow(row) {
  if (!row) {
    return createDefaultSecurityConfig();
  }

  return {
    sessionDurationHours: row.session_duration_hours,
    maxFailedLoginAttempts: row.max_failed_logins,
    lockoutDurationMinutes: row.lockout_minutes,
    rateLimitDefaults: JSON.parse(row.rate_limit_defaults_json || "{}"),
    iosMinSupportedVersion: row.ios_min_supported_version || "",
    iosRecommendedVersion: row.ios_recommended_version || "",
    iosUpdateMessage: row.ios_update_message || "",
    iosAutoRecommendedVersion: Boolean(row.ios_auto_recommended_version),
    iosLastAppStoreVersion: row.ios_last_app_store_version || "",
    iosLastAppStoreSyncAt: row.ios_last_app_store_sync_at || "",
    iosAppStoreSyncError: row.ios_app_store_sync_error || "",
  };
}

function createAdminSecurityConfigService({
  appConfigRepository,
  appStoreConnectService,
  audit,
  now = () => new Date().toISOString(),
  platformConfig = defaultConfig,
}) {
  if (!appConfigRepository) {
    throw new Error("appConfigRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function persistSecurityConfig(config, actorId, { audit: shouldAudit = true } = {}) {
    const timestamp = now();
    await appConfigRepository.upsertSecurityConfig({
      sessionDurationHours: config.sessionDurationHours,
      maxFailedLoginAttempts: config.maxFailedLoginAttempts,
      lockoutDurationMinutes: config.lockoutDurationMinutes,
      rateLimitDefaultsJson: JSON.stringify(config.rateLimitDefaults),
      iosMinSupportedVersion: config.iosMinSupportedVersion || null,
      iosRecommendedVersion: config.iosRecommendedVersion || null,
      iosUpdateMessage: config.iosUpdateMessage || null,
      iosAutoRecommendedVersion: config.iosAutoRecommendedVersion ? 1 : 0,
      iosLastAppStoreVersion: config.iosLastAppStoreVersion || null,
      iosLastAppStoreSyncAt: config.iosLastAppStoreSyncAt || null,
      iosAppStoreSyncError: config.iosAppStoreSyncError || null,
      updatedAt: timestamp,
      updatedBy: actorId,
    });

    if (shouldAudit) {
      await audit(
        actorId,
        "admin_update_security_config",
        "config",
        "security",
        config,
      );
    }

    return { success: true };
  }

  async function getSecurityConfig() {
    const securityConfig =
      await appConfigRepository.findSecurityConfig("default");
    return mapSecurityConfigRow(securityConfig);
  }

  async function updateSecurityConfig(config, adminId) {
    return persistSecurityConfig(config, adminId, { audit: true });
  }

  async function syncIOSVersionFromAppStore(adminId, { force = true } = {}) {
    if (!appStoreConnectService?.isConfigured()) {
      throw new Error("App Store Connect credentials are not configured");
    }

    const version = await appStoreConnectService.getLatestReadyIOSVersion({
      force,
    });
    if (!version) {
      throw new Error(
        "No iOS App Store version in Ready for Distribution state was found",
      );
    }

    const current = await getSecurityConfig();
    const syncedAt = now();
    const nextConfig = {
      ...current,
      iosLastAppStoreVersion: version,
      iosLastAppStoreSyncAt: syncedAt,
      iosAppStoreSyncError: "",
      iosRecommendedVersion: current.iosAutoRecommendedVersion
        ? current.iosRecommendedVersion
        : version,
    };

    await persistSecurityConfig(nextConfig, adminId, { audit: false });
    await audit(
      adminId,
      "admin_sync_ios_version_from_app_store",
      "config",
      "security",
      {
        version,
        autoRecommendedVersion: current.iosAutoRecommendedVersion,
      },
    );

    return {
      success: true,
      version,
      syncedAt,
    };
  }

  async function resolveIOSAppUpdatePolicy({
    allowLiveAppStoreSync = false,
    exposeSyncError = false,
  } = {}) {
    const securityConfig = await getSecurityConfig();
    let recommendedVersion = securityConfig.iosRecommendedVersion || null;
    let lastSyncedVersion = securityConfig.iosLastAppStoreVersion || null;
    const lastSyncAt = securityConfig.iosLastAppStoreSyncAt || null;
    let lastSyncError = securityConfig.iosAppStoreSyncError || null;

    if (securityConfig.iosAutoRecommendedVersion && lastSyncedVersion) {
      recommendedVersion = lastSyncedVersion;
    }

    if (
      allowLiveAppStoreSync &&
      securityConfig.iosAutoRecommendedVersion &&
      appStoreConnectService?.isConfigured()
    ) {
      try {
        const detectedVersion =
          await appStoreConnectService.getLatestReadyIOSVersion();
        if (detectedVersion) {
          recommendedVersion = detectedVersion;
          lastSyncedVersion = detectedVersion;
          lastSyncError = "";
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "App Store Connect sync failed";
        lastSyncError = message;
      }
    }

    return {
      minimum_supported_version: securityConfig.iosMinSupportedVersion || null,
      minimum_supported_build:
        platformConfig.IOS_MIN_SUPPORTED_BUILD > 0
          ? platformConfig.IOS_MIN_SUPPORTED_BUILD
          : null,
      recommended_version: recommendedVersion,
      recommended_build:
        platformConfig.IOS_RECOMMENDED_BUILD > 0
          ? platformConfig.IOS_RECOMMENDED_BUILD
          : null,
      message: securityConfig.iosUpdateMessage || null,
      app_store_url: platformConfig.APP_STORE_URL || null,
      auto_recommended_version: securityConfig.iosAutoRecommendedVersion,
      last_app_store_version: lastSyncedVersion,
      last_app_store_sync_at: lastSyncAt,
      ...(exposeSyncError
        ? { last_app_store_sync_error: lastSyncError }
        : {}),
    };
  }

  return {
    getSecurityConfig,
    updateSecurityConfig,
    syncIOSVersionFromAppStore,
    resolveIOSAppUpdatePolicy,
  };
}

module.exports = {
  createAdminSecurityConfigService,
  createDefaultSecurityConfig,
  mapSecurityConfigRow,
};
