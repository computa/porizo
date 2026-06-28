function isLiveProvidersEnabled(appConfig = {}) {
  return Boolean(appConfig.LIVE_PROVIDERS) && !appConfig.DEV_MODE;
}

function normalizeMusicProvider(_value) {
  return "suno";
}

function createProviderRuntimeConfig(appConfig = {}) {
  const liveEnabled = isLiveProvidersEnabled(appConfig);
  const elevenlabsApiKey = appConfig.ELEVENLABS_API_KEY || "";
  const replicateToken = appConfig.REPLICATE_API_TOKEN || "";
  const replicateModelVersion = appConfig.REPLICATE_MODEL_VERSION || "";
  const providerConfig = {
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

module.exports = {
  createHealthCheckRuntimeConfig,
  createProviderRuntimeConfig,
  createStorageRuntimeConfig,
  isLiveProvidersEnabled,
  normalizeMusicProvider,
};
