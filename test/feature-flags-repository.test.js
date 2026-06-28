process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createFeatureFlagsRepository } = require("../src/database/feature-flags-repository");
const {
  DEFAULTS,
  clearCache,
  getFeatureFlag,
  getFeatureFlags,
  setFeatureFlag,
} = require("../src/services/feature-flags");

let db;
let repository;

async function seedFlag(flagId, value, updatedBy = "feature-flag-repo-test") {
  await repository.upsertValue({
    flagId,
    value: JSON.stringify(value),
    updatedAt: "2026-06-26T00:00:00.000Z",
    updatedBy,
  });
}

describe("FeatureFlagsRepository", () => {
  beforeEach(async () => {
    clearCache();
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createFeatureFlagsRepository(db);
  });

  afterEach(async () => {
    clearCache();
    if (db) {
      await db.close();
      db = null;
    }
  });

  test("upserts and reads JSON-backed flag values", async () => {
    await repository.upsertValue({
      flagId: "repo_contract_flag",
      value: JSON.stringify({ enabled: true, rollout: 25 }),
      updatedAt: "2026-06-26T01:02:03.000Z",
      updatedBy: "repo-test",
    });

    const row = await repository.findValueById("repo_contract_flag");
    assert.deepEqual(row, {
      value: '{"enabled":true,"rollout":25}',
    });

    const rows = await repository.findValuesByIds([
      "repo_contract_flag",
      "missing_repo_contract_flag",
    ]);
    assert.deepEqual(rows, [
      {
        id: "repo_contract_flag",
        value: '{"enabled":true,"rollout":25}',
      },
    ]);

    const metadata = await db.prepare(`
      SELECT updated_at, updated_by
      FROM feature_flags
      WHERE id = ?
    `).get("repo_contract_flag");
    assert.deepEqual(metadata, {
      updated_at: "2026-06-26T01:02:03.000Z",
      updated_by: "repo-test",
    });
  });

  test("service returns defaults for absent known flags and null for unknown flags", async () => {
    assert.equal(
      await getFeatureFlag(db, "show_design_screens"),
      DEFAULTS.show_design_screens,
    );
    assert.equal(await getFeatureFlag(db, "unknown_feature_flag"), null);

    const flags = await getFeatureFlags(db, [
      "show_design_screens",
      "unknown_feature_flag",
    ]);
    assert.deepEqual(flags, {
      show_design_screens: DEFAULTS.show_design_screens,
      unknown_feature_flag: null,
    });
  });

  test("service keeps the existing per-flag cache contract", async () => {
    await seedFlag("cache_contract_flag", "first");

    assert.equal(await getFeatureFlag(db, "cache_contract_flag"), "first");

    await seedFlag("cache_contract_flag", "second");

    assert.equal(await getFeatureFlag(db, "cache_contract_flag"), "first");

    clearCache();
    assert.equal(await getFeatureFlag(db, "cache_contract_flag"), "second");
  });

  test("batch reads keep valid rows and default corrupted or missing rows", async () => {
    await seedFlag("web_player_letterbox_rollout_percent", 40);
    await db.prepare(`
      INSERT INTO feature_flags (id, value, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      "my_voice_enabled",
      "{not-json",
      "2026-06-26T00:00:00.000Z",
      "feature-flag-repo-test",
    );

    const flags = await getFeatureFlags(db, [
      "web_player_letterbox_rollout_percent",
      "my_voice_enabled",
      "missing_batch_flag",
    ]);

    assert.deepEqual(flags, {
      web_player_letterbox_rollout_percent: 40,
      my_voice_enabled: DEFAULTS.my_voice_enabled,
      missing_batch_flag: null,
    });
  });

  test("batch reads preserve the single-read fallback when all() is unavailable", async () => {
    const fallbackRepository = {
      findValuesByIds: async (flagIds) => {
        assert.deepEqual(flagIds, [
          "my_voice_enabled",
          "unknown_fallback_flag",
        ]);
        return null;
      },
      findValueById: async (flagId) => {
        if (flagId === "my_voice_enabled") {
          return { value: "false" };
        }
        return null;
      },
    };

    const flags = await getFeatureFlags(null, [
      "my_voice_enabled",
      "unknown_fallback_flag",
    ], {
      repository: fallbackRepository,
    });

    assert.deepEqual(flags, {
      my_voice_enabled: false,
      unknown_fallback_flag: null,
    });
  });

  test("throwOnError keeps the existing read error envelope", async () => {
    const failingRepository = {
      findValueById: async () => {
        throw new Error("database offline");
      },
    };

    await assert.rejects(
      () => getFeatureFlag(null, "my_voice_enabled", {
        throwOnError: true,
        repository: failingRepository,
      }),
      /FF001_DB_READ_ERROR: Database error reading flag my_voice_enabled: database offline/,
    );

    assert.equal(
      await getFeatureFlag(null, "my_voice_enabled", {
        repository: failingRepository,
      }),
      DEFAULTS.my_voice_enabled,
    );
  });

  test("setFeatureFlag writes through the repository and updates cache after success", async () => {
    await setFeatureFlag(db, "set_contract_flag", true, "repo-test");

    assert.equal(await getFeatureFlag(db, "set_contract_flag"), true);

    const row = await db.prepare(`
      SELECT value, updated_by
      FROM feature_flags
      WHERE id = ?
    `).get("set_contract_flag");
    assert.deepEqual(row, {
      value: "true",
      updated_by: "repo-test",
    });
  });

  test("setFeatureFlag keeps the existing write error envelope", async () => {
    const failingRepository = {
      upsertValue: async () => {
        throw new Error("disk full");
      },
    };

    await assert.rejects(
      () => setFeatureFlag(null, "write_error_flag", true, "repo-test", {
        repository: failingRepository,
      }),
      /FF004_WRITE_ERROR: Failed to save flag write_error_flag: disk full/,
    );
  });
});
