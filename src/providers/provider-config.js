const { sanitizeStyleOverrides } = require("./style-registry");
const { clampNumber } = require("../utils/common");

const MUSIC_PROVIDER_CONFIG_KEY = "music_provider_config";
const SUNO_MODELS = Object.freeze(["V4_5", "V5", "V5_5"]);
const ELEVENLABS_GENERATION_MODES = Object.freeze([
  "composition_plan",
  "compose_detailed",
]);

function isLiveProvidersEnabled(appConfig = {}) {
  return Boolean(appConfig.LIVE_PROVIDERS) && !appConfig.DEV_MODE;
}

function normalizeMusicProvider(_value) {
  return "suno";
}

function normalizeSunoModel(value, fallback = "V5") {
  return SUNO_MODELS.includes(value) ? value : fallback;
}

function normalizeElevenLabsGenerationMode(value) {
  return value === "compose_detailed" ? "compose_detailed" : "composition_plan";
}

function getDefaultMusicProviderConfig(options = {}) {
  const result = {
    default_provider: "suno",
    suno_model: normalizeSunoModel(options.sunoModel, "V5"),
    auto_style_routing: true,
    elevenlabs_generation_mode: "composition_plan",
    auto_reroll_enabled: true,
    quality_threshold: 72,
    max_rerolls: 1,
    style_overrides: {},
  };

  if (options.includeMetadata) {
    result.updated_at = options.updatedAt || null;
    result.updated_by = options.updatedBy || null;
  }

  return result;
}

function normalizeMusicProviderConfig(rawConfig = {}, options = {}) {
  const raw =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
  const fallback = {
    ...getDefaultMusicProviderConfig({
      sunoModel: options.sunoModel,
    }),
    ...(options.fallback || {}),
  };
  const maxRerolls = Number(raw.max_rerolls);
  const normalized = {
    default_provider: "suno",
    suno_model: normalizeSunoModel(raw.suno_model, fallback.suno_model),
    auto_style_routing: raw.auto_style_routing !== false,
    elevenlabs_generation_mode: normalizeElevenLabsGenerationMode(
      raw.elevenlabs_generation_mode,
    ),
    auto_reroll_enabled: raw.auto_reroll_enabled !== false,
    quality_threshold: clampNumber(
      raw.quality_threshold,
      0,
      100,
      fallback.quality_threshold,
    ),
    max_rerolls: Number.isInteger(maxRerolls)
      ? Math.max(0, Math.min(3, maxRerolls))
      : fallback.max_rerolls,
    style_overrides: sanitizeStyleOverrides(raw.style_overrides),
  };

  if (options.includeMetadata) {
    normalized.updated_at = options.updatedAt || null;
    normalized.updated_by = options.updatedBy || null;
  }

  return normalized;
}

function applyMusicProviderConfigPatch(existingConfig = {}, patch = {}) {
  const next = normalizeMusicProviderConfig(existingConfig);

  if (Object.prototype.hasOwnProperty.call(patch, "default_provider")) {
    if (patch.default_provider !== "suno") {
      throw new Error(
        "default_provider must be suno; ElevenLabs no longer handles song generation",
      );
    }
    next.default_provider = "suno";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "suno_model")) {
    if (!SUNO_MODELS.includes(patch.suno_model)) {
      throw new Error("suno_model must be one of: V4_5, V5, V5_5");
    }
    next.suno_model = patch.suno_model;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "auto_style_routing")) {
    if (typeof patch.auto_style_routing !== "boolean") {
      throw new Error("auto_style_routing must be boolean");
    }
    next.auto_style_routing = patch.auto_style_routing;
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, "elevenlabs_generation_mode")
  ) {
    if (!ELEVENLABS_GENERATION_MODES.includes(patch.elevenlabs_generation_mode)) {
      throw new Error(
        "elevenlabs_generation_mode must be one of: composition_plan, compose_detailed",
      );
    }
    next.elevenlabs_generation_mode = patch.elevenlabs_generation_mode;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "auto_reroll_enabled")) {
    if (typeof patch.auto_reroll_enabled !== "boolean") {
      throw new Error("auto_reroll_enabled must be boolean");
    }
    next.auto_reroll_enabled = patch.auto_reroll_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "quality_threshold")) {
    const threshold = Number(patch.quality_threshold);
    if (!Number.isFinite(threshold)) {
      throw new Error("quality_threshold must be a number between 0 and 100");
    }
    next.quality_threshold = Math.max(0, Math.min(100, threshold));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "max_rerolls")) {
    const maxRerolls = Number(patch.max_rerolls);
    if (!Number.isInteger(maxRerolls) || maxRerolls < 0 || maxRerolls > 3) {
      throw new Error("max_rerolls must be an integer between 0 and 3");
    }
    next.max_rerolls = maxRerolls;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "style_overrides")) {
    if (
      patch.style_overrides !== null &&
      typeof patch.style_overrides !== "object"
    ) {
      throw new Error("style_overrides must be an object map");
    }
    next.style_overrides = sanitizeStyleOverrides(patch.style_overrides || {});
  }

  return next;
}

function parseMusicProviderConfigJson(valueJson, options = {}) {
  if (!valueJson) {
    return {
      config: normalizeMusicProviderConfig({}, options),
      parseError: null,
    };
  }

  try {
    return {
      config: normalizeMusicProviderConfig(JSON.parse(valueJson), options),
      parseError: null,
    };
  } catch (err) {
    return {
      config: normalizeMusicProviderConfig({}, options),
      parseError: err,
    };
  }
}

function createProviderRuntimeConfig(appConfig = {}) {
  const liveEnabled = isLiveProvidersEnabled(appConfig);
  const elevenlabsApiKey = appConfig.ELEVENLABS_API_KEY || "";
  const replicateToken = appConfig.REPLICATE_API_TOKEN || "";
  const replicateModelVersion = appConfig.REPLICATE_MODEL_VERSION || "";
  const providerConfig = {
    whisper: {
      apiKey: appConfig.OPENAI_API_KEY || "",
      timeoutMs: appConfig.WHISPER_TIMEOUT_MS || appConfig.PROVIDER_TIMEOUT_MS,
    },
    elevenlabs: {
      // ElevenLabs remains available for TTS and voice conversion, but not music routing.
      live: false,
      healthCheckEnabled: liveEnabled && Boolean(elevenlabsApiKey),
      provider: "elevenlabs",
      apiKey: elevenlabsApiKey,
      baseUrl: appConfig.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io",
      endpoint: appConfig.ELEVENLABS_MUSIC_ENDPOINT || "/v1/music",
      compositionPlanEndpoint:
        appConfig.ELEVENLABS_COMPOSITION_PLAN_ENDPOINT || "/v1/music/plan",
      voiceId: appConfig.ELEVENLABS_VOICE_ID || "",
      ttsVoiceId: appConfig.ELEVENLABS_TTS_VOICE_ID || "",
      timeoutMs: appConfig.PROVIDER_TIMEOUT_MS,
    },
    suno: {
      live: liveEnabled && Boolean(appConfig.SUNO_API_KEY),
      provider: "suno",
      apiKey: appConfig.SUNO_API_KEY || "",
      baseUrl: appConfig.SUNO_BASE_URL || "https://api.sunoapi.org",
      timeoutMs: appConfig.PROVIDER_TIMEOUT_MS,
    },
    replicate: {
      live:
        liveEnabled &&
        Boolean(replicateToken) &&
        Boolean(replicateModelVersion),
      token: replicateToken,
      baseUrl: appConfig.REPLICATE_BASE_URL || "https://api.replicate.com",
      modelVersion: replicateModelVersion,
      rvcModel: appConfig.DEFAULT_AI_VOICE_MODEL || "",
      timeoutMs: appConfig.PROVIDER_TIMEOUT_MS,
      demucsModel: appConfig.DEMUCS_SEPARATION_MODEL || null,
      demucsShifts: appConfig.DEMUCS_SHIFTS,
    },
    hfToken: appConfig.HF_TOKEN || null,
  };
  const musicProvider = normalizeMusicProvider(appConfig.MUSIC_PROVIDER);
  return {
    providerConfig,
    providerStatus: {
      elevenlabs: providerConfig.elevenlabs.live,
      suno: providerConfig.suno.live,
      replicate: providerConfig.replicate.live,
      musicProvider,
      musicProviderSource: "runtime_config_with_env_fallback",
    },
  };
}

function createStorageRuntimeConfig(appConfig = {}) {
  return {
    STORAGE_PROVIDER: appConfig.STORAGE_PROVIDER,
    STORAGE_DIR: appConfig.STORAGE_DIR,
    STREAM_BASE_URL: appConfig.STREAM_BASE_URL,
    UPLOAD_SIGNING_SECRET: appConfig.UPLOAD_SIGNING_SECRET,
    UPLOAD_URL_TTL_SEC: appConfig.UPLOAD_URL_TTL_SEC,
    S3_ACCESS_KEY_ID: appConfig.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: appConfig.S3_SECRET_ACCESS_KEY,
    S3_SESSION_TOKEN: appConfig.S3_SESSION_TOKEN,
    S3_BUCKET: appConfig.S3_BUCKET,
    S3_REGION: appConfig.S3_REGION,
    S3_ENDPOINT: appConfig.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: appConfig.S3_FORCE_PATH_STYLE,
    S3_URL_EXPIRES_SEC: appConfig.S3_URL_EXPIRES_SEC,
    KMS_KEY_ID: appConfig.KMS_KEY_ID,
    KMS_REGION: appConfig.KMS_REGION,
    KMS_USE_BUCKET_KEY: appConfig.KMS_USE_BUCKET_KEY,
  };
}

function createHealthCheckRuntimeConfig(providerConfig = {}, options = {}) {
  const elevenlabs = providerConfig.elevenlabs || {};
  const replicate = providerConfig.replicate || {};
  return {
    elevenlabsApiKey: elevenlabs.healthCheckEnabled
      ? elevenlabs.apiKey || ""
      : "",
    elevenlabsBaseUrl: elevenlabs.baseUrl || "https://api.elevenlabs.io",
    replicateToken: replicate.live ? replicate.token || "" : "",
    replicateBaseUrl: replicate.baseUrl || "https://api.replicate.com",
    timeoutMs:
      options.timeoutMs ||
      elevenlabs.timeoutMs ||
      replicate.timeoutMs ||
      5000,
  };
}

function createWhisperRuntimeConfig(providerConfig = {}, options = {}) {
  const whisper = providerConfig.whisper || {};
  return {
    apiKey: whisper.apiKey || "",
    timeoutMs: options.timeoutMs || whisper.timeoutMs,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
  };
}

module.exports = {
  applyMusicProviderConfigPatch,
  createHealthCheckRuntimeConfig,
  createProviderRuntimeConfig,
  createStorageRuntimeConfig,
  createWhisperRuntimeConfig,
  ELEVENLABS_GENERATION_MODES,
  getDefaultMusicProviderConfig,
  isLiveProvidersEnabled,
  MUSIC_PROVIDER_CONFIG_KEY,
  normalizeMusicProviderConfig,
  normalizeMusicProvider,
  parseMusicProviderConfigJson,
  SUNO_MODELS,
};
