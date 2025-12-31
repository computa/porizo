const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "data", "porizo.db");
const STORAGE_DIR =
  process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
const PREVIEW_ONLY = process.env.PREVIEW_ONLY === "true";
const STREAM_BASE_URL =
  process.env.STREAM_BASE_URL || `http://localhost:${PORT}`;
const LIVE_PROVIDERS = process.env.LIVE_PROVIDERS === "true";
// Dev mode: skip all provider API calls, use placeholders instead
const DEV_MODE = process.env.DEV_MODE === "true";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_BASE_URL =
  process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
const ELEVENLABS_MUSIC_ENDPOINT =
  process.env.ELEVENLABS_MUSIC_ENDPOINT || "/v1/music";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
// Default TTS voice: "Rachel" - clear female voice good for singing
const ELEVENLABS_TTS_VOICE_ID = process.env.ELEVENLABS_TTS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || "";
const REPLICATE_EMBEDDING_MODEL_VERSION =
  process.env.REPLICATE_EMBEDDING_MODEL_VERSION || "";
const REPLICATE_BASE_URL =
  process.env.REPLICATE_BASE_URL || "https://api.replicate.com";
// Suno music generation can take 3-4 minutes for longer songs
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 300000);

// Suno API (third-party provider) - alternative to ElevenLabs for music generation
const SUNO_API_KEY = process.env.SUNO_API_KEY || "";
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";
// Music provider selection: "elevenlabs" (default) or "suno"
const MUSIC_PROVIDER = process.env.MUSIC_PROVIDER || "elevenlabs";
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 600000);

// Hugging Face API token for Seed-VC (optional, for rate limit bypass)
const HF_TOKEN = process.env.HF_TOKEN || "";
// Voice mode: "ai_voice" (pre-trained RVC models) or "personalized" (user's enrolled voice via Seed-VC)
// Default to "ai_voice" for backward compatibility
const DEFAULT_VOICE_MODE = process.env.DEFAULT_VOICE_MODE || "ai_voice";

module.exports = {
  PORT,
  DB_PATH,
  STORAGE_DIR,
  PREVIEW_ONLY,
  STREAM_BASE_URL,
  LIVE_PROVIDERS,
  DEV_MODE,
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MUSIC_ENDPOINT,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_TTS_VOICE_ID,
  REPLICATE_API_TOKEN,
  REPLICATE_MODEL_VERSION,
  REPLICATE_EMBEDDING_MODEL_VERSION,
  REPLICATE_BASE_URL,
  PROVIDER_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  SUNO_API_KEY,
  SUNO_BASE_URL,
  MUSIC_PROVIDER,
  HF_TOKEN,
  DEFAULT_VOICE_MODE,
};
