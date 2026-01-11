const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "data", "porizo.db");
const STORAGE_DIR =
  process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || "local";
const UPLOAD_SIGNING_SECRET = process.env.UPLOAD_SIGNING_SECRET || "";
const UPLOAD_URL_TTL_SEC = Number(process.env.UPLOAD_URL_TTL_SEC || 900);
const PREVIEW_ONLY = process.env.PREVIEW_ONLY === "true";
const STREAM_BASE_URL =
  process.env.STREAM_BASE_URL || `http://localhost:${PORT}`;
// Public-facing URL for share links (can differ from internal STREAM_BASE_URL in production)
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const LIVE_PROVIDERS = process.env.LIVE_PROVIDERS === "true";
// Dev mode: skip all provider API calls, use placeholders instead
const DEV_MODE = process.env.DEV_MODE === "true";
const INLINE_JOB_RUNNER = process.env.INLINE_JOB_RUNNER !== "false";

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
// Voice mode: "ai_voice" (pre-trained RVC models) or "user_voice" (user's enrolled voice via Seed-VC)
// Default to "ai_voice" for backward compatibility
const DEFAULT_VOICE_MODE = process.env.DEFAULT_VOICE_MODE || "ai_voice";
// AI voice model for RVC - used when voice_mode is "ai_voice"
// This is a pre-trained model identifier for Replicate's RVC
const DEFAULT_AI_VOICE_MODEL = process.env.DEFAULT_AI_VOICE_MODEL || "Squidward";

// S3 storage configuration (for production-grade uploads)
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
const S3_ACCESS_KEY_ID =
  process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY =
  process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
const S3_SESSION_TOKEN =
  process.env.S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || "";
const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE || "false";
const S3_URL_EXPIRES_SEC = Number(process.env.S3_URL_EXPIRES_SEC || 900);

module.exports = {
  PORT,
  DB_PATH,
  STORAGE_DIR,
  STORAGE_PROVIDER,
  UPLOAD_SIGNING_SECRET,
  UPLOAD_URL_TTL_SEC,
  PREVIEW_ONLY,
  STREAM_BASE_URL,
  PUBLIC_BASE_URL,
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
  DEFAULT_AI_VOICE_MODEL,
  S3_BUCKET,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_SESSION_TOKEN,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  S3_URL_EXPIRES_SEC,
  INLINE_JOB_RUNNER,
};
