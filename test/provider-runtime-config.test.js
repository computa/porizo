const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  applyMusicProviderConfigPatch,
  createHealthCheckRuntimeConfig,
  createProviderRuntimeConfig,
  createStorageRuntimeConfig,
  isLiveProvidersEnabled,
  normalizeMusicProviderConfig,
  normalizeMusicProvider,
  parseMusicProviderConfigJson,
} = require("../src/providers/provider-config");

describe("Provider runtime config factory", () => {
  test("disables live providers when DEV_MODE is enabled", () => {
    assert.equal(
      isLiveProvidersEnabled({ LIVE_PROVIDERS: true, DEV_MODE: true }),
      false,
    );
  });

  test("centralizes music provider policy for server and worker boot paths", () => {
    const { providerConfig, providerStatus } = createProviderRuntimeConfig({
      LIVE_PROVIDERS: true,
      DEV_MODE: false,
      ELEVENLABS_API_KEY: "elevenlabs-key",
      ELEVENLABS_BASE_URL: "https://elevenlabs.example",
      ELEVENLABS_MUSIC_ENDPOINT: "/music",
      ELEVENLABS_COMPOSITION_PLAN_ENDPOINT: "/music/plan",
      ELEVENLABS_VOICE_ID: "voice-music",
      ELEVENLABS_TTS_VOICE_ID: "voice-tts",
      SUNO_API_KEY: "suno-key",
      SUNO_BASE_URL: "https://suno.example",
      REPLICATE_API_TOKEN: "replicate-token",
      REPLICATE_MODEL_VERSION: "replicate-version",
      REPLICATE_BASE_URL: "https://replicate.example",
      DEFAULT_AI_VOICE_MODEL: "Squidward",
      PROVIDER_TIMEOUT_MS: 1234,
      DEMUCS_SEPARATION_MODEL: "htdemucs_ft",
      DEMUCS_SHIFTS: 3,
      HF_TOKEN: "hf-token",
      MUSIC_PROVIDER: "elevenlabs",
    });

    assert.equal(providerConfig.elevenlabs.live, false);
    assert.equal(providerConfig.elevenlabs.apiKey, "elevenlabs-key");
    assert.equal(providerConfig.elevenlabs.ttsVoiceId, "voice-tts");
    assert.equal(providerConfig.suno.live, true);
    assert.equal(providerConfig.replicate.live, true);
    assert.equal(providerConfig.replicate.rvcModel, "Squidward");
    assert.equal(providerConfig.replicate.demucsModel, "htdemucs_ft");
    assert.equal(providerConfig.replicate.demucsShifts, 3);
    assert.equal(providerConfig.hfToken, "hf-token");
    assert.deepEqual(providerStatus, {
      elevenlabs: false,
      suno: true,
      replicate: true,
      musicProvider: "suno",
      musicProviderSource: "runtime_config_with_env_fallback",
    });
  });

  test("normalizes legacy music provider env values to Suno", () => {
    assert.equal(normalizeMusicProvider("elevenlabs"), "suno");
    assert.equal(normalizeMusicProvider("suno"), "suno");
    assert.equal(normalizeMusicProvider(null), "suno");
  });

  test("normalizes persisted music provider config through one Suno-only policy", () => {
    const normalized = normalizeMusicProviderConfig(
      {
        default_provider: "elevenlabs",
        suno_model: "V6",
        auto_style_routing: false,
        elevenlabs_generation_mode: "compose_detailed",
        auto_reroll_enabled: false,
        quality_threshold: 120,
        max_rerolls: 10,
        style_overrides: {
          "  Ogene  ": {
            elevenlabs: {
              support: "strong",
              instruction_override: "  lock to ogene bells  ",
            },
          },
        },
      },
      {
        fallback: {
          suno_model: "V5_5",
          quality_threshold: 72,
          max_rerolls: 1,
        },
      },
    );

    assert.equal(normalized.default_provider, "suno");
    assert.equal(normalized.suno_model, "V5_5");
    assert.equal(normalized.auto_style_routing, false);
    assert.equal(normalized.elevenlabs_generation_mode, "compose_detailed");
    assert.equal(normalized.auto_reroll_enabled, false);
    assert.equal(normalized.quality_threshold, 100);
    assert.equal(normalized.max_rerolls, 3);
    assert.equal(
      normalized.style_overrides.ogene.elevenlabs.instruction_override,
      "lock to ogene bells",
    );
  });

  test("validates music provider config patches before persistence", () => {
    assert.deepEqual(
      applyMusicProviderConfigPatch(
        {
          default_provider: "suno",
          suno_model: "V5",
          auto_style_routing: true,
          elevenlabs_generation_mode: "composition_plan",
          auto_reroll_enabled: true,
          quality_threshold: 72,
          max_rerolls: 1,
          style_overrides: {},
        },
        {
          suno_model: "V5_5",
          quality_threshold: 81,
          max_rerolls: 2,
        },
      ),
      {
        default_provider: "suno",
        suno_model: "V5_5",
        auto_style_routing: true,
        elevenlabs_generation_mode: "composition_plan",
        auto_reroll_enabled: true,
        quality_threshold: 81,
        max_rerolls: 2,
        style_overrides: {},
      },
    );

    assert.throws(
      () =>
        applyMusicProviderConfigPatch(
          { default_provider: "suno" },
          { default_provider: "elevenlabs" },
        ),
      /default_provider must be suno/,
    );
  });

  test("parses persisted music provider config JSON with normalized fallback", () => {
    const parsed = parseMusicProviderConfigJson(
      JSON.stringify({
        suno_model: "V4_5",
        quality_threshold: 80,
      }),
    );

    assert.equal(parsed.parseError, null);
    assert.equal(parsed.config.suno_model, "V4_5");
    assert.equal(parsed.config.quality_threshold, 80);

    const invalid = parseMusicProviderConfigJson("{not-json", {
      fallback: {
        suno_model: "V5_5",
        quality_threshold: 72,
        max_rerolls: 1,
      },
    });

    assert.ok(invalid.parseError);
    assert.equal(invalid.config.suno_model, "V5_5");
    assert.equal(invalid.config.quality_threshold, 72);
  });

  test("requires both Replicate token and model version before enabling Replicate", () => {
    const { providerConfig } = createProviderRuntimeConfig({
      LIVE_PROVIDERS: true,
      DEV_MODE: false,
      REPLICATE_API_TOKEN: "replicate-token",
      REPLICATE_MODEL_VERSION: "",
    });

    assert.equal(providerConfig.replicate.live, false);
  });

  test("disables provider health checks when live providers are disabled", () => {
    const { providerConfig } = createProviderRuntimeConfig({
      LIVE_PROVIDERS: false,
      DEV_MODE: true,
      ELEVENLABS_API_KEY: "elevenlabs-key",
      ELEVENLABS_BASE_URL: "https://elevenlabs.example",
      REPLICATE_API_TOKEN: "replicate-token",
      REPLICATE_BASE_URL: "https://replicate.example",
      PROVIDER_TIMEOUT_MS: 1234,
    });

    assert.deepEqual(
      createHealthCheckRuntimeConfig(providerConfig, { timeoutMs: 5000 }),
      {
        elevenlabsApiKey: "",
        elevenlabsBaseUrl: "https://elevenlabs.example",
        replicateToken: "",
        replicateBaseUrl: "https://replicate.example",
        timeoutMs: 5000,
      },
    );
  });

  test("derives live provider health-check config from normalized provider config", () => {
    const { providerConfig } = createProviderRuntimeConfig({
      LIVE_PROVIDERS: true,
      DEV_MODE: false,
      ELEVENLABS_API_KEY: "elevenlabs-key",
      ELEVENLABS_BASE_URL: "https://elevenlabs.example",
      REPLICATE_API_TOKEN: "replicate-token",
      REPLICATE_MODEL_VERSION: "replicate-version",
      REPLICATE_BASE_URL: "https://replicate.example",
      PROVIDER_TIMEOUT_MS: 1234,
    });

    assert.deepEqual(createHealthCheckRuntimeConfig(providerConfig), {
      elevenlabsApiKey: "elevenlabs-key",
      elevenlabsBaseUrl: "https://elevenlabs.example",
      replicateToken: "replicate-token",
      replicateBaseUrl: "https://replicate.example",
      timeoutMs: 1234,
    });
  });

  test("does not health-check Replicate without the required model version", () => {
    const { providerConfig } = createProviderRuntimeConfig({
      LIVE_PROVIDERS: true,
      DEV_MODE: false,
      REPLICATE_API_TOKEN: "replicate-token",
      REPLICATE_MODEL_VERSION: "",
    });

    assert.equal(createHealthCheckRuntimeConfig(providerConfig).replicateToken, "");
  });

  test("passes storage credentials through one shared boot-path shape", () => {
    const storageConfig = createStorageRuntimeConfig({
      STORAGE_PROVIDER: "s3",
      STORAGE_DIR: "/tmp/storage",
      STREAM_BASE_URL: "https://stream.example",
      UPLOAD_SIGNING_SECRET: "upload-secret",
      UPLOAD_URL_TTL_SEC: 600,
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_SESSION_TOKEN: "session",
      S3_BUCKET: "bucket",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: "https://s3.example",
      S3_FORCE_PATH_STYLE: "true",
      S3_URL_EXPIRES_SEC: 900,
      KMS_KEY_ID: "alias/porizo",
      KMS_REGION: "us-west-2",
      KMS_USE_BUCKET_KEY: "true",
    });

    assert.deepEqual(storageConfig, {
      STORAGE_PROVIDER: "s3",
      STORAGE_DIR: "/tmp/storage",
      STREAM_BASE_URL: "https://stream.example",
      UPLOAD_SIGNING_SECRET: "upload-secret",
      UPLOAD_URL_TTL_SEC: 600,
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_SESSION_TOKEN: "session",
      S3_BUCKET: "bucket",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: "https://s3.example",
      S3_FORCE_PATH_STYLE: "true",
      S3_URL_EXPIRES_SEC: 900,
      KMS_KEY_ID: "alias/porizo",
      KMS_REGION: "us-west-2",
      KMS_USE_BUCKET_KEY: "true",
    });
  });
});
