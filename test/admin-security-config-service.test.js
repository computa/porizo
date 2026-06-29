const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminSecurityConfigService,
} = require("../src/services/admin/security-config-service");

function rowFromPayload(payload) {
  return {
    id: "default",
    session_duration_hours: payload.sessionDurationHours,
    max_failed_logins: payload.maxFailedLoginAttempts,
    lockout_minutes: payload.lockoutDurationMinutes,
    rate_limit_defaults_json: payload.rateLimitDefaultsJson,
    ios_min_supported_version: payload.iosMinSupportedVersion,
    ios_recommended_version: payload.iosRecommendedVersion,
    ios_update_message: payload.iosUpdateMessage,
    ios_auto_recommended_version: payload.iosAutoRecommendedVersion,
    ios_last_app_store_version: payload.iosLastAppStoreVersion,
    ios_last_app_store_sync_at: payload.iosLastAppStoreSyncAt,
    ios_app_store_sync_error: payload.iosAppStoreSyncError,
    updated_at: payload.updatedAt,
    updated_by: payload.updatedBy,
  };
}

function createSecurityConfigFixture({
  row = null,
  appStoreConnectService = {},
  platformConfig = {},
} = {}) {
  const calls = [];
  const audits = [];
  let currentRow = row;

  const repository = {
    findSecurityConfig: async (id = "default") => {
      calls.push({ name: "findSecurityConfig", id });
      return currentRow ? { ...currentRow } : currentRow;
    },
    upsertSecurityConfig: async (payload) => {
      calls.push({ name: "upsertSecurityConfig", payload });
      currentRow = rowFromPayload(payload);
    },
  };

  const service = createAdminSecurityConfigService({
    appConfigRepository: repository,
    appStoreConnectService: {
      isConfigured: () => false,
      ...appStoreConnectService,
    },
    audit: async (...args) => audits.push(args),
    now: () => "2026-06-29T10:00:00.000Z",
    platformConfig: {
      APP_STORE_URL: "https://apps.example/porizo",
      IOS_MIN_SUPPORTED_BUILD: 0,
      IOS_RECOMMENDED_BUILD: 0,
      ...platformConfig,
    },
  });

  return {
    audits,
    calls,
    getCurrentRow: () => currentRow,
    service,
  };
}

const persistedRow = {
  id: "default",
  session_duration_hours: 12,
  max_failed_logins: 6,
  lockout_minutes: 20,
  rate_limit_defaults_json: JSON.stringify({
    track_create: { limit: 10, windowSeconds: 3600 },
  }),
  ios_min_supported_version: "1.0.0",
  ios_recommended_version: "1.2.0",
  ios_update_message: "Please update.",
  ios_auto_recommended_version: 1,
  ios_last_app_store_version: "1.3.0",
  ios_last_app_store_sync_at: "2026-06-28T10:00:00.000Z",
  ios_app_store_sync_error: "previous sync failed",
};

const writableConfig = {
  sessionDurationHours: 12,
  maxFailedLoginAttempts: 6,
  lockoutDurationMinutes: 20,
  rateLimitDefaults: {
    track_create: { limit: 10, windowSeconds: 3600 },
  },
  iosMinSupportedVersion: "",
  iosRecommendedVersion: "",
  iosUpdateMessage: "",
  iosAutoRecommendedVersion: true,
  iosLastAppStoreVersion: "",
  iosLastAppStoreSyncAt: "",
  iosAppStoreSyncError: "",
};

describe("AdminSecurityConfigService", () => {
  test("returns security defaults when no row exists", async () => {
    const { service } = createSecurityConfigFixture();

    assert.deepEqual(await service.getSecurityConfig(), {
      sessionDurationHours: 8,
      maxFailedLoginAttempts: 5,
      lockoutDurationMinutes: 15,
      rateLimitDefaults: {
        enrollment_start: { limit: 3, windowSeconds: 86400 },
        render_preview: { limit: 20, windowSeconds: 86400 },
        track_create: { limit: 20, windowSeconds: 3600 },
      },
      iosMinSupportedVersion: "",
      iosRecommendedVersion: "",
      iosUpdateMessage: "",
      iosAutoRecommendedVersion: false,
      iosLastAppStoreVersion: "",
      iosLastAppStoreSyncAt: "",
      iosAppStoreSyncError: "",
    });
  });

  test("maps persisted security config rows with JSON and iOS fields", async () => {
    const { service } = createSecurityConfigFixture({ row: persistedRow });

    assert.deepEqual(await service.getSecurityConfig(), {
      sessionDurationHours: 12,
      maxFailedLoginAttempts: 6,
      lockoutDurationMinutes: 20,
      rateLimitDefaults: {
        track_create: { limit: 10, windowSeconds: 3600 },
      },
      iosMinSupportedVersion: "1.0.0",
      iosRecommendedVersion: "1.2.0",
      iosUpdateMessage: "Please update.",
      iosAutoRecommendedVersion: true,
      iosLastAppStoreVersion: "1.3.0",
      iosLastAppStoreSyncAt: "2026-06-28T10:00:00.000Z",
      iosAppStoreSyncError: "previous sync failed",
    });
  });

  test("updates config with DB null conversion and update audit", async () => {
    const { audits, calls, service } = createSecurityConfigFixture();

    assert.deepEqual(
      await service.updateSecurityConfig(writableConfig, "admin_security"),
      { success: true },
    );

    assert.deepEqual(
      calls.filter((call) => call.name === "upsertSecurityConfig"),
      [
        {
          name: "upsertSecurityConfig",
          payload: {
            sessionDurationHours: 12,
            maxFailedLoginAttempts: 6,
            lockoutDurationMinutes: 20,
            rateLimitDefaultsJson: JSON.stringify(
              writableConfig.rateLimitDefaults,
            ),
            iosMinSupportedVersion: null,
            iosRecommendedVersion: null,
            iosUpdateMessage: null,
            iosAutoRecommendedVersion: 1,
            iosLastAppStoreVersion: null,
            iosLastAppStoreSyncAt: null,
            iosAppStoreSyncError: null,
            updatedAt: "2026-06-29T10:00:00.000Z",
            updatedBy: "admin_security",
          },
        },
      ],
    );
    assert.deepEqual(audits, [
      [
        "admin_security",
        "admin_update_security_config",
        "config",
        "security",
        writableConfig,
      ],
    ]);
  });

  test("sync requires configured App Store Connect and a ready iOS version", async () => {
    const unconfigured = createSecurityConfigFixture();

    await assert.rejects(
      () => unconfigured.service.syncIOSVersionFromAppStore("admin_security"),
      /App Store Connect credentials are not configured/,
    );

    const noReadyVersion = createSecurityConfigFixture({
      appStoreConnectService: {
        isConfigured: () => true,
        getLatestReadyIOSVersion: async () => null,
      },
    });

    await assert.rejects(
      () => noReadyVersion.service.syncIOSVersionFromAppStore("admin_security"),
      /No iOS App Store version in Ready for Distribution state was found/,
    );
  });

  test("sync stores detected version, suppresses generic audit, and emits sync audit", async () => {
    const appStoreCalls = [];
    const { audits, calls, service } = createSecurityConfigFixture({
      row: {
        ...persistedRow,
        ios_auto_recommended_version: 0,
        ios_recommended_version: "1.2.0",
      },
      appStoreConnectService: {
        isConfigured: () => true,
        getLatestReadyIOSVersion: async (options) => {
          appStoreCalls.push(options);
          return "1.5.0";
        },
      },
    });

    assert.deepEqual(
      await service.syncIOSVersionFromAppStore("admin_security", {
        force: false,
      }),
      {
        success: true,
        version: "1.5.0",
        syncedAt: "2026-06-29T10:00:00.000Z",
      },
    );

    assert.deepEqual(appStoreCalls, [{ force: false }]);
    const persisted = calls.find((call) => call.name === "upsertSecurityConfig");
    assert.equal(persisted.payload.iosRecommendedVersion, "1.5.0");
    assert.equal(persisted.payload.iosLastAppStoreVersion, "1.5.0");
    assert.equal(
      persisted.payload.iosLastAppStoreSyncAt,
      "2026-06-29T10:00:00.000Z",
    );
    assert.equal(persisted.payload.iosAppStoreSyncError, null);
    assert.deepEqual(audits, [
      [
        "admin_security",
        "admin_sync_ios_version_from_app_store",
        "config",
        "security",
        { version: "1.5.0", autoRecommendedVersion: false },
      ],
    ]);
  });

  test("sync preserves stored recommended version when auto mode is enabled", async () => {
    const { calls, service } = createSecurityConfigFixture({
      row: {
        ...persistedRow,
        ios_auto_recommended_version: 1,
        ios_recommended_version: "1.2.0",
      },
      appStoreConnectService: {
        isConfigured: () => true,
        getLatestReadyIOSVersion: async () => "1.5.0",
      },
    });

    await service.syncIOSVersionFromAppStore("admin_security");

    const persisted = calls.find((call) => call.name === "upsertSecurityConfig");
    assert.equal(persisted.payload.iosRecommendedVersion, "1.2.0");
    assert.equal(persisted.payload.iosLastAppStoreVersion, "1.5.0");
  });

  test("projects public iOS policy from cached config without exposing sync errors", async () => {
    let liveLookupCalled = false;
    const { service } = createSecurityConfigFixture({
      row: {
        ...persistedRow,
        ios_min_supported_version: "1.1.0",
        ios_recommended_version: "1.2.0",
        ios_auto_recommended_version: 1,
        ios_last_app_store_version: "1.5.0",
      },
      appStoreConnectService: {
        isConfigured: () => true,
        getLatestReadyIOSVersion: async () => {
          liveLookupCalled = true;
          return "1.6.0";
        },
      },
      platformConfig: {
        IOS_MIN_SUPPORTED_BUILD: 42,
        IOS_RECOMMENDED_BUILD: 84,
      },
    });

    assert.deepEqual(await service.resolveIOSAppUpdatePolicy(), {
      minimum_supported_version: "1.1.0",
      minimum_supported_build: 42,
      recommended_version: "1.5.0",
      recommended_build: 84,
      message: "Please update.",
      app_store_url: "https://apps.example/porizo",
      auto_recommended_version: true,
      last_app_store_version: "1.5.0",
      last_app_store_sync_at: "2026-06-28T10:00:00.000Z",
    });
    assert.equal(liveLookupCalled, false);
  });

  test("live policy lookup can expose sync errors without persisting them", async () => {
    const appStoreCalls = [];
    const { calls, service } = createSecurityConfigFixture({
      row: {
        ...persistedRow,
        ios_auto_recommended_version: 1,
        ios_last_app_store_version: "1.5.0",
      },
      appStoreConnectService: {
        isConfigured: () => true,
        getLatestReadyIOSVersion: async (options) => {
          appStoreCalls.push(options);
          throw new Error("live sync failed");
        },
      },
    });

    const policy = await service.resolveIOSAppUpdatePolicy({
      allowLiveAppStoreSync: true,
      exposeSyncError: true,
    });

    assert.equal(policy.recommended_version, "1.5.0");
    assert.equal(policy.last_app_store_sync_error, "live sync failed");
    assert.deepEqual(appStoreCalls, [undefined]);
    assert.equal(
      calls.some((call) => call.name === "upsertSecurityConfig"),
      false,
    );
  });
});
