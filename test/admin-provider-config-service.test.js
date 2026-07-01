const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  createAdminProviderConfigService,
} = require("../src/services/admin/provider-config-service");
const {
  MUSIC_PROVIDER_CONFIG_KEY,
} = require("../src/providers/provider-config");

function createRepository(seed = {}) {
  const configs = new Map(Object.entries(seed));
  const writes = [];
  return {
    writes,
    async findConfigValue(key) {
      const value = configs.get(key);
      if (!value) return null;
      return typeof value === "object" ? value : { value_json: value };
    },
    async listProviderStatusByNameLike() {
      return [
        { provider_name: "stt_whisperkit", status: "healthy" },
        { provider_name: "stt_openai", status: "degraded" },
      ];
    },
    async upsertConfigValue(payload) {
      writes.push(payload);
      configs.set(payload.key, {
        value_json: payload.valueJson,
        updated_at: payload.updatedAt,
        updated_by: payload.updatedBy,
      });
    },
  };
}

describe("AdminProviderConfigService", () => {
  test("returns STT defaults with provider status when config is missing", async () => {
    const service = createAdminProviderConfigService({
      appConfigRepository: createRepository(),
      audit: async () => {},
    });

    assert.deepEqual(await service.getSTTConfig(), {
      primary_provider: "whisperkit",
      fallback_provider: "openai",
      whisperkit_model: "small",
      provider_status: {
        stt_openai: "degraded",
        stt_whisperkit: "healthy",
      },
    });
  });

  test("falls back to STT defaults when persisted JSON is invalid", async () => {
    const service = createAdminProviderConfigService({
      appConfigRepository: createRepository({
        stt_config: "{not-json",
      }),
      audit: async () => {},
    });

    const config = await service.getSTTConfig();
    assert.equal(config.primary_provider, "whisperkit");
    assert.equal(config.fallback_provider, "openai");
    assert.equal(config.whisperkit_model, "small");
  });

  test("updates STT config and records audit metadata", async () => {
    const repository = createRepository();
    const audits = [];
    const service = createAdminProviderConfigService({
      appConfigRepository: repository,
      audit: async (...args) => audits.push(args),
      now: () => "2026-06-29T00:00:00.000Z",
    });

    const result = await service.setSTTConfig(
      { primary_provider: "apple", whisperkit_model: "large" },
      "admin_1",
    );

    assert.deepEqual(result.config, {
      primary_provider: "apple",
      fallback_provider: "openai",
      whisperkit_model: "large",
    });
    assert.equal(repository.writes[0].key, "stt_config");
    assert.deepEqual(audits[0], [
      "admin_1",
      "admin_update_stt_config",
      "config",
      "stt",
      result.config,
    ]);
  });

  test("normalizes and updates music provider config through one service boundary", async () => {
    const repository = createRepository({
      [MUSIC_PROVIDER_CONFIG_KEY]: {
        value_json: JSON.stringify({ default_provider: "elevenlabs" }),
        updated_at: "2026-06-28T00:00:00.000Z",
        updated_by: "legacy_admin",
      },
    });
    const audits = [];
    const service = createAdminProviderConfigService({
      appConfigRepository: repository,
      audit: async (...args) => audits.push(args),
      now: () => "2026-06-29T00:00:00.000Z",
    });

    const before = await service.getMusicProviderConfig();
    assert.equal(before.default_provider, "suno");
    assert.equal(before.updated_by, "legacy_admin");

    const result = await service.setMusicProviderConfig(
      { suno_model: "V5_5", quality_threshold: 81 },
      "admin_2",
    );

    assert.equal(result.config.default_provider, "suno");
    assert.equal(result.config.suno_model, "V5_5");
    assert.equal(result.config.quality_threshold, 81);
    assert.equal(repository.writes[0].key, MUSIC_PROVIDER_CONFIG_KEY);
    assert.deepEqual(audits[0], [
      "admin_2",
      "admin_update_music_provider_config",
      "config",
      "music_provider",
      result.config,
    ]);
  });
});
