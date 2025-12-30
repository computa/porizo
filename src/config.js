const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "data", "porizo.db");
const STORAGE_DIR =
  process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
const PREVIEW_ONLY = process.env.PREVIEW_ONLY === "true";
const STREAM_BASE_URL =
  process.env.STREAM_BASE_URL || "https://cdn.porizo.local/stream";
const LIVE_PROVIDERS = process.env.LIVE_PROVIDERS === "true";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_BASE_URL =
  process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
const ELEVENLABS_MUSIC_ENDPOINT =
  process.env.ELEVENLABS_MUSIC_ENDPOINT || "/v1/music";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || "";
const REPLICATE_BASE_URL =
  process.env.REPLICATE_BASE_URL || "https://api.replicate.com";
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 120000);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 600000);

module.exports = {
  PORT,
  DB_PATH,
  STORAGE_DIR,
  PREVIEW_ONLY,
  STREAM_BASE_URL,
  LIVE_PROVIDERS,
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MUSIC_ENDPOINT,
  ELEVENLABS_VOICE_ID,
  REPLICATE_API_TOKEN,
  REPLICATE_MODEL_VERSION,
  REPLICATE_BASE_URL,
  PROVIDER_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
};
