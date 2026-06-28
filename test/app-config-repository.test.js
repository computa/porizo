process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAppConfigRepository,
} = require("../src/database/app-config-repository");

let db;
let repository;

describe("AppConfigRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAppConfigRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listActiveGiftBundles returns active bundles ordered by sort_order", async () => {
    await db.prepare("DELETE FROM gift_bundles").run();
    await db
      .prepare(
        `INSERT INTO gift_bundles
          (product_id, token_count, price_cents, display_name, sort_order, is_active)
         VALUES
          ('bundle_hidden', 9, 9999, 'Hidden', 0, 0),
          ('bundle_three', 3, 1299, '3 Gifts', 20, 1),
          ('bundle_one', 1, 499, '1 Gift', 10, 1)`,
      )
      .run();

    const bundles = await repository.listActiveGiftBundles();

    assert.deepEqual(bundles, [
      {
        product_id: "bundle_one",
        token_count: 1,
        display_name: "1 Gift",
        sort_order: 10,
      },
      {
        product_id: "bundle_three",
        token_count: 3,
        display_name: "3 Gifts",
        sort_order: 20,
      },
    ]);
  });

  test("findActiveOnboardingSample returns the client-safe active sample fields", async () => {
    await db.prepare("DELETE FROM onboarding_samples").run();
    await db
      .prepare(
        `INSERT INTO onboarding_samples
          (id, label, audio_url, is_active)
         VALUES
          ('sample_inactive', 'Inactive', '/audio/inactive.mp3', 0),
          ('sample_active', 'Active Sample', '/audio/active.mp3', 1)`,
      )
      .run();

    const sample = await repository.findActiveOnboardingSample();

    assert.deepEqual(sample, {
      label: "Active Sample",
      audio_url: "/audio/active.mp3",
    });
  });

  test("findConfigValue and upsertConfigValue preserve JSON and metadata", async () => {
    const updatedAt = "2026-06-27T10:00:00.000Z";

    await repository.upsertConfigValue({
      key: "test_runtime_config",
      valueJson: JSON.stringify({ enabled: true }),
      updatedAt,
      updatedBy: "admin_test",
    });

    assert.deepEqual(await repository.findConfigValue("test_runtime_config"), {
      value_json: JSON.stringify({ enabled: true }),
      updated_at: updatedAt,
      updated_by: "admin_test",
    });

    await repository.upsertConfigValue({
      key: "test_runtime_config",
      valueJson: JSON.stringify({ enabled: false }),
      updatedAt: "2026-06-27T10:05:00.000Z",
      updatedBy: "admin_next",
    });

    assert.deepEqual(await repository.findConfigValue("test_runtime_config"), {
      value_json: JSON.stringify({ enabled: false }),
      updated_at: "2026-06-27T10:05:00.000Z",
      updated_by: "admin_next",
    });
  });

  test("listProviderStatusByNameLike returns provider names and statuses", async () => {
    await db.prepare("DELETE FROM provider_status").run();
    await db
      .prepare(
        `INSERT INTO provider_status (id, provider_name, status, updated_at)
         VALUES
          ('prov_stt_one', 'stt_one', 'active', ?),
          ('prov_stt_two', 'stt_two', 'paused', ?),
          ('prov_music', 'music_one', 'disabled', ?)`,
      )
      .run(
        "2026-06-27T10:00:00.000Z",
        "2026-06-27T10:00:00.000Z",
        "2026-06-27T10:00:00.000Z",
      );

    const statuses = await repository.listProviderStatusByNameLike("stt_%");

    assert.deepEqual(
      statuses.sort((a, b) => a.provider_name.localeCompare(b.provider_name)),
      [
        { provider_name: "stt_one", status: "active" },
        { provider_name: "stt_two", status: "paused" },
      ],
    );
  });

  test("findSecurityConfig and upsertSecurityConfig persist app update policy fields", async () => {
    await db
      .prepare(
        `INSERT INTO admin_users (id, email, password_hash, role, created_at)
         VALUES ('admin_security', 'security@example.com', 'x', 'superadmin', ?)`,
      )
      .run("2026-06-27T09:00:00.000Z");

    await repository.upsertSecurityConfig({
      sessionDurationHours: 12,
      maxFailedLoginAttempts: 4,
      lockoutDurationMinutes: 20,
      rateLimitDefaultsJson: JSON.stringify({
        track_create: { limit: 10, windowSeconds: 3600 },
      }),
      iosMinSupportedVersion: "1.2.0",
      iosRecommendedVersion: "1.4.0",
      iosUpdateMessage: "Update to continue.",
      iosAutoRecommendedVersion: 1,
      iosLastAppStoreVersion: "1.5.0",
      iosLastAppStoreSyncAt: "2026-06-27T10:00:00.000Z",
      iosAppStoreSyncError: null,
      updatedAt: "2026-06-27T10:01:00.000Z",
      updatedBy: "admin_security",
    });

    const row = await repository.findSecurityConfig();

    assert.equal(row.id, "default");
    assert.equal(row.session_duration_hours, 12);
    assert.equal(row.max_failed_logins, 4);
    assert.equal(row.lockout_minutes, 20);
    assert.equal(row.rate_limit_defaults_json, JSON.stringify({
      track_create: { limit: 10, windowSeconds: 3600 },
    }));
    assert.equal(row.ios_min_supported_version, "1.2.0");
    assert.equal(row.ios_recommended_version, "1.4.0");
    assert.equal(row.ios_update_message, "Update to continue.");
    assert.equal(row.ios_auto_recommended_version, 1);
    assert.equal(row.ios_last_app_store_version, "1.5.0");
    assert.equal(row.ios_last_app_store_sync_at, "2026-06-27T10:00:00.000Z");
    assert.equal(row.ios_app_store_sync_error, null);
    assert.equal(row.updated_at, "2026-06-27T10:01:00.000Z");
    assert.equal(row.updated_by, "admin_security");
  });
});
