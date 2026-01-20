const path = require("path");
const config = require("./config");
const { initDb } = require("./db");
const { startJobRunner } = require("./workflows/runner");
const { createStorageProvider } = require("./storage");
const { createEventsService } = require("./services/events-service");

// IMPORTANT: sql.js loads the database into memory per-process.
// Running worker.js separately from server.js causes database desync.
// Use INLINE_JOB_RUNNER=true (default) in development instead.
if (config.INLINE_JOB_RUNNER) {
  console.error("[Worker] ERROR: INLINE_JOB_RUNNER is enabled (default).");
  console.error("[Worker] The server already runs the job runner inline.");
  console.error("[Worker] Running worker.js separately will cause database desync with sql.js.");
  console.error("[Worker] Either:");
  console.error("[Worker]   1. Just run the server: node src/server.js");
  console.error("[Worker]   2. Or set INLINE_JOB_RUNNER=false and use PostgreSQL");
  process.exit(1);
}

async function startWorker() {
  const db = await initDb({
    dbPath: config.DB_PATH,
    migrationsDir: path.join(process.cwd(), "migrations"),
  });

  const liveEnabled = config.LIVE_PROVIDERS && !config.DEV_MODE;
  const musicProvider = config.MUSIC_PROVIDER || "elevenlabs";
  const providerConfig = {
    elevenlabs: {
      live: liveEnabled && musicProvider === "elevenlabs" && Boolean(config.ELEVENLABS_API_KEY),
      provider: "elevenlabs",
      apiKey: config.ELEVENLABS_API_KEY,
      baseUrl: config.ELEVENLABS_BASE_URL,
      endpoint: config.ELEVENLABS_MUSIC_ENDPOINT,
      voiceId: config.ELEVENLABS_VOICE_ID,
      ttsVoiceId: config.ELEVENLABS_TTS_VOICE_ID,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    suno: {
      live: liveEnabled && musicProvider === "suno" && Boolean(config.SUNO_API_KEY),
      provider: "suno",
      apiKey: config.SUNO_API_KEY,
      baseUrl: config.SUNO_BASE_URL,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    replicate: {
      live:
        liveEnabled &&
        Boolean(config.REPLICATE_API_TOKEN) &&
        Boolean(config.REPLICATE_MODEL_VERSION),
      token: config.REPLICATE_API_TOKEN,
      baseUrl: config.REPLICATE_BASE_URL,
      modelVersion: config.REPLICATE_MODEL_VERSION,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    },
    hfToken: config.HF_TOKEN || null,
  };

  // Create storage provider (S3 in production, local in dev)
  const storage = createStorageProvider({
    STORAGE_PROVIDER: config.STORAGE_PROVIDER,
    S3_ACCESS_KEY_ID: config.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: config.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: config.S3_BUCKET,
    S3_REGION: config.S3_REGION,
    S3_ENDPOINT: config.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: config.S3_FORCE_PATH_STYLE,
    KMS_KEY_ID: config.KMS_KEY_ID,
    KMS_REGION: config.KMS_REGION,
    KMS_USE_BUCKET_KEY: config.KMS_USE_BUCKET_KEY,
  });

  const eventsService = createEventsService(db);

  const runner = startJobRunner({
    db,
    storageDir: config.STORAGE_DIR,
    streamBaseUrl: config.STREAM_BASE_URL,
    intervalMs: 1000,
    providerConfig,
    devMode: config.DEV_MODE,
    storageProvider: storage,
    eventsService,
  });

  const saveTimer = setInterval(() => db.save(), 2000);

  const shutdown = async () => {
    runner.stop();
    clearInterval(saveTimer);
    db.save();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[Worker] Job worker started.");
}

startWorker().catch((err) => {
  console.error("[Worker] Failed to start:", err);
  process.exit(1);
});
