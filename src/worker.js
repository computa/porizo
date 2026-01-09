const path = require("path");
const config = require("./config");
const { initDb } = require("./db");
const { startJobRunner } = require("./workflows/runner");

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

  const runner = startJobRunner({
    db,
    storageDir: config.STORAGE_DIR,
    streamBaseUrl: config.STREAM_BASE_URL,
    intervalMs: 1000,
    providerConfig,
    devMode: config.DEV_MODE,
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
