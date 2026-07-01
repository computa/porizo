"use strict";

const {
  applyMusicProviderConfigPatch,
  MUSIC_PROVIDER_CONFIG_KEY,
  normalizeMusicProviderConfig,
  parseMusicProviderConfigJson,
} = require("../../providers/provider-config");

const DEFAULT_STT_CONFIG = Object.freeze({
  primary_provider: "whisperkit",
  fallback_provider: "openai",
  whisperkit_model: "small",
});
const VALID_STT_PROVIDERS = Object.freeze(["apple", "whisperkit", "openai"]);
const VALID_WHISPERKIT_MODELS = Object.freeze([
  "tiny",
  "small",
  "medium",
  "large",
]);

function parseSttConfig(valueJson) {
  if (!valueJson) {
    return { ...DEFAULT_STT_CONFIG };
  }
  try {
    return {
      ...DEFAULT_STT_CONFIG,
      ...JSON.parse(valueJson),
    };
  } catch {
    return { ...DEFAULT_STT_CONFIG };
  }
}

function createAdminProviderConfigService({
  appConfigRepository,
  audit,
  logger = console,
  now = () => new Date().toISOString(),
}) {
  if (!appConfigRepository) {
    throw new Error("appConfigRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function getSTTConfig() {
    const configRow =
      await appConfigRepository.findConfigValue("stt_config");
    const config = parseSttConfig(configRow?.value_json);
    const providerStatus =
      await appConfigRepository.listProviderStatusByNameLike("stt_%");

    const statusMap = {};
    for (const provider of providerStatus) {
      statusMap[provider.provider_name] = provider.status;
    }

    return {
      primary_provider: config.primary_provider,
      fallback_provider: config.fallback_provider,
      whisperkit_model: config.whisperkit_model,
      provider_status: statusMap,
    };
  }

  async function setSTTConfig(config, adminId) {
    if (
      config.primary_provider &&
      !VALID_STT_PROVIDERS.includes(config.primary_provider)
    ) {
      throw new Error(`Invalid primary_provider: ${config.primary_provider}`);
    }
    if (
      config.fallback_provider &&
      !VALID_STT_PROVIDERS.includes(config.fallback_provider)
    ) {
      throw new Error(`Invalid fallback_provider: ${config.fallback_provider}`);
    }
    if (
      config.whisperkit_model &&
      !VALID_WHISPERKIT_MODELS.includes(config.whisperkit_model)
    ) {
      throw new Error(`Invalid whisperkit_model: ${config.whisperkit_model}`);
    }

    const existing = await getSTTConfig();
    const newConfig = {
      primary_provider: config.primary_provider || existing.primary_provider,
      fallback_provider: config.fallback_provider || existing.fallback_provider,
      whisperkit_model: config.whisperkit_model || existing.whisperkit_model,
    };

    await appConfigRepository.upsertConfigValue({
      key: "stt_config",
      valueJson: JSON.stringify(newConfig),
      updatedAt: now(),
      updatedBy: adminId,
    });

    await audit(
      adminId,
      "admin_update_stt_config",
      "config",
      "stt",
      newConfig,
    );

    return { success: true, config: newConfig };
  }

  async function getMusicProviderConfig() {
    const row = await appConfigRepository.findConfigValue(
      MUSIC_PROVIDER_CONFIG_KEY,
    );

    if (!row) {
      return normalizeMusicProviderConfig(
        {},
        {
          includeMetadata: true,
        },
      );
    }

    const parsed = parseMusicProviderConfigJson(row.value_json, {
      includeMetadata: true,
      updatedAt: row.updated_at || null,
      updatedBy: row.updated_by || null,
    });
    if (parsed.parseError) {
      logger.warn?.(
        "[AdminProviderConfigService] Invalid music_provider_config JSON, using defaults",
      );
    }
    return parsed.config;
  }

  async function setMusicProviderConfig(config, adminId) {
    const existing = await getMusicProviderConfig();
    const newConfig = applyMusicProviderConfigPatch(existing, config);

    await appConfigRepository.upsertConfigValue({
      key: MUSIC_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(newConfig),
      updatedAt: now(),
      updatedBy: adminId,
    });

    await audit(
      adminId,
      "admin_update_music_provider_config",
      "config",
      "music_provider",
      newConfig,
    );

    return { success: true, config: newConfig };
  }

  return {
    getMusicProviderConfig,
    getSTTConfig,
    setMusicProviderConfig,
    setSTTConfig,
  };
}

module.exports = {
  createAdminProviderConfigService,
  DEFAULT_STT_CONFIG,
};
