const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
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
const APP_STORE_URL =
  process.env.APP_STORE_URL || "https://apps.apple.com/app/porizo/id6742382730";
const PLAY_STORE_URL =
  process.env.PLAY_STORE_URL || "https://play.google.com/store/apps/details?id=com.porizo.app";
const IOS_TESTFLIGHT_URL = process.env.IOS_TESTFLIGHT_URL || "";
const LIVE_PROVIDERS = process.env.LIVE_PROVIDERS === "true";
// Dev mode: skip all provider API calls, use placeholders instead
const DEV_MODE = process.env.DEV_MODE === "true";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "";
const SHARE_COVER_VERSION = process.env.SHARE_COVER_VERSION || "";
// 0 = full audio duration for share.mp4 social previews
const SHARE_VIDEO_MAX_DURATION_SEC = Number(process.env.SHARE_VIDEO_MAX_DURATION_SEC || 0);
const INLINE_JOB_RUNNER = process.env.INLINE_JOB_RUNNER !== "false";
const ALLOW_ANON_USER_ID = process.env.ALLOW_ANON_USER_ID === "true";
const ALLOW_DEVICE_TOKEN_FALLBACK =
  process.env.ALLOW_DEVICE_TOKEN_FALLBACK === "true";
const ENABLE_DEBUG_ROUTES = process.env.ENABLE_DEBUG_ROUTES === "true";
const ENABLE_V3_ORCHESTRATION_ROUTES =
  process.env.ENABLE_V3_ORCHESTRATION_ROUTES === "true";
const ORCHESTRATION_EXECUTOR_MODE =
  (process.env.ORCHESTRATION_EXECUTOR_MODE || "local").toLowerCase();
const ORCHESTRATION_EXTERNAL_COMMAND_JSON =
  process.env.ORCHESTRATION_EXTERNAL_COMMAND_JSON || "";
const ORCHESTRATION_EXTERNAL_TIMEOUT_MS =
  Number(process.env.ORCHESTRATION_EXTERNAL_TIMEOUT_MS || 120000);
const REQUIRE_S3 = process.env.REQUIRE_S3 === "true";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_BASE_URL =
  process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
const ELEVENLABS_MUSIC_ENDPOINT =
  process.env.ELEVENLABS_MUSIC_ENDPOINT || "/v1/music";
const ELEVENLABS_COMPOSITION_PLAN_ENDPOINT =
  process.env.ELEVENLABS_COMPOSITION_PLAN_ENDPOINT || "/v1/music/plan";
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
// Music provider fallback default: "suno" or "elevenlabs"
// Runtime default can be overridden from app_config.music_provider_config.
const MUSIC_PROVIDER = process.env.MUSIC_PROVIDER || "suno";
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 600000);
const GIFT_DISPATCH_INTERVAL_MS = Number(process.env.GIFT_DISPATCH_INTERVAL_MS || 30000);
const GIFT_DISPATCH_MAX_ATTEMPTS = Number(process.env.GIFT_DISPATCH_MAX_ATTEMPTS || 5);
const GIFT_RESERVATION_TTL_MINUTES = Number(process.env.GIFT_RESERVATION_TTL_MINUTES || 45);
const GIFT_RESERVATION_SWEEP_INTERVAL_MS = Number(process.env.GIFT_RESERVATION_SWEEP_INTERVAL_MS || 60000);
const GIFT_TOKEN_PRODUCT_ID =
  process.env.GIFT_TOKEN_PRODUCT_ID || "com.porizo.gift_token_oneoff";
const APPLE_APP_STORE_KEY_ID = process.env.APPLE_APP_STORE_KEY_ID || "";
const APPLE_APP_STORE_ISSUER_ID = process.env.APPLE_APP_STORE_ISSUER_ID || "";
const APPLE_APP_STORE_PRIVATE_KEY = process.env.APPLE_APP_STORE_PRIVATE_KEY || "";
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || "";
const APPLE_ENVIRONMENT = process.env.APPLE_ENVIRONMENT || "production";

// OpenAI API key for Whisper speech-to-text
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Hugging Face API token for Seed-VC (optional, for rate limit bypass)
const HF_TOKEN = process.env.HF_TOKEN || "";
// Voice mode: "ai_voice" (pre-trained RVC models) or "user_voice" (user's enrolled voice via Seed-VC)
// Default to "ai_voice" for backward compatibility
const DEFAULT_VOICE_MODE = process.env.DEFAULT_VOICE_MODE || "ai_voice";
// AI voice model for RVC - used when voice_mode is "ai_voice"
// This is a pre-trained model identifier for Replicate's RVC
const DEFAULT_AI_VOICE_MODEL = process.env.DEFAULT_AI_VOICE_MODEL || "Squidward";

// Seed-VC voice conversion parameters
// cfgRate controls voice fidelity vs natural singing balance:
// - 0.3-0.5: Voice cover mode (natural singing, reasonable voice similarity)
// - 0.6-0.8: Voice cloning mode (strong similarity, may sound robotic)
const SEEDVC_CFG_RATE = Number(process.env.SEEDVC_CFG_RATE || 0.65);
const DEMUCS_SEPARATION_MODEL = process.env.DEMUCS_SEPARATION_MODEL || "htdemucs_ft";
const DEMUCS_SHIFTS = Number(process.env.DEMUCS_SHIFTS || 3);

// S3-compatible storage configuration (supports AWS S3 and Cloudflare R2)
// R2_* env vars take precedence, with S3_*/AWS_* as fallbacks
const S3_BUCKET = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || "auto"; // R2 uses "auto"
const S3_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
const S3_SESSION_TOKEN =
  process.env.S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || "";
// R2 endpoint format: https://<account-id>.r2.cloudflarestorage.com
const S3_ENDPOINT = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || "";
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE || "true"; // R2 works best with path-style
const S3_URL_EXPIRES_SEC = Number(process.env.S3_URL_EXPIRES_SEC || 900);

// Story session configuration
const STORY_MAX_TURNS = Number(process.env.STORY_MAX_TURNS || 30);
const STORY_SESSION_TTL_HOURS = Number(process.env.STORY_SESSION_TTL_HOURS || 24);
const STORY_MAX_CONVERSATION_TURNS = Number(process.env.STORY_MAX_CONVERSATION_TURNS || 100);
const STORY_ENGINE_DEFAULT = "v3";

// Polling configuration
const SUNO_MAX_POLL_ATTEMPTS = Number(process.env.SUNO_MAX_POLL_ATTEMPTS || 60);
const SUNO_POLL_INITIAL_INTERVAL_MS = Number(process.env.SUNO_POLL_INITIAL_INTERVAL_MS || 5000);
const SUNO_POLL_MAX_INTERVAL_MS = Number(process.env.SUNO_POLL_MAX_INTERVAL_MS || 30000);
const REPLICATE_MAX_POLL_ATTEMPTS = Number(process.env.REPLICATE_MAX_POLL_ATTEMPTS || 120);
const REPLICATE_POLL_INITIAL_INTERVAL_MS = Number(process.env.REPLICATE_POLL_INITIAL_INTERVAL_MS || 2000);
const REPLICATE_POLL_MAX_INTERVAL_MS = Number(process.env.REPLICATE_POLL_MAX_INTERVAL_MS || 15000);

// Render pipeline configuration
const FFMPEG_MAX_STDERR_SIZE = Number(process.env.FFMPEG_MAX_STDERR_SIZE || 10000);
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 120000);

// HTTP client configuration
const HTTP_DEFAULT_TIMEOUT_MS = Number(process.env.HTTP_DEFAULT_TIMEOUT_MS || 30000);
const HTTP_MAX_RETRIES = Number(process.env.HTTP_MAX_RETRIES || 3);

// Cache/CDN configuration
const AUDIO_CACHE_MAX_AGE_SEC = Number(process.env.AUDIO_CACHE_MAX_AGE_SEC || 31536000); // 1 year
const AUDIO_CACHE_IMMUTABLE = process.env.AUDIO_CACHE_IMMUTABLE !== "false";

// Admin dashboard configuration
// In production, ADMIN_SECRET_KEY must be explicitly set (no fallback)
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY ||
  (process.env.NODE_ENV === "production" ? (() => { throw new Error("ADMIN_SECRET_KEY must be set in production"); })() : "dev-admin-key-change-in-prod");

// Database and worker configuration
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);

module.exports = {
  PORT,
  HOST,
  DB_PATH,
  STORAGE_DIR,
  STORAGE_PROVIDER,
  UPLOAD_SIGNING_SECRET,
  UPLOAD_URL_TTL_SEC,
  PREVIEW_ONLY,
  STREAM_BASE_URL,
  PUBLIC_BASE_URL,
  APP_STORE_URL,
  PLAY_STORE_URL,
  IOS_TESTFLIGHT_URL,
  LIVE_PROVIDERS,
  DEV_MODE,
  FACEBOOK_APP_ID,
  SHARE_COVER_VERSION,
  SHARE_VIDEO_MAX_DURATION_SEC,
  OPENAI_API_KEY,
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MUSIC_ENDPOINT,
  ELEVENLABS_COMPOSITION_PLAN_ENDPOINT,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_TTS_VOICE_ID,
  REPLICATE_API_TOKEN,
  REPLICATE_MODEL_VERSION,
  REPLICATE_EMBEDDING_MODEL_VERSION,
  REPLICATE_BASE_URL,
  PROVIDER_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  GIFT_DISPATCH_INTERVAL_MS,
  GIFT_DISPATCH_MAX_ATTEMPTS,
  GIFT_RESERVATION_TTL_MINUTES,
  GIFT_RESERVATION_SWEEP_INTERVAL_MS,
  GIFT_TOKEN_PRODUCT_ID,
  APPLE_APP_STORE_KEY_ID,
  APPLE_APP_STORE_ISSUER_ID,
  APPLE_APP_STORE_PRIVATE_KEY,
  APPLE_BUNDLE_ID,
  APPLE_ENVIRONMENT,
  SUNO_API_KEY,
  SUNO_BASE_URL,
  MUSIC_PROVIDER,
  HF_TOKEN,
  DEFAULT_VOICE_MODE,
  DEFAULT_AI_VOICE_MODEL,
  SEEDVC_CFG_RATE,
  DEMUCS_SEPARATION_MODEL,
  DEMUCS_SHIFTS,
  S3_BUCKET,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_SESSION_TOKEN,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  S3_URL_EXPIRES_SEC,
  INLINE_JOB_RUNNER,
  ALLOW_ANON_USER_ID,
  ALLOW_DEVICE_TOKEN_FALLBACK,
  ENABLE_DEBUG_ROUTES,
  ENABLE_V3_ORCHESTRATION_ROUTES,
  ORCHESTRATION_EXECUTOR_MODE,
  ORCHESTRATION_EXTERNAL_COMMAND_JSON,
  ORCHESTRATION_EXTERNAL_TIMEOUT_MS,
  REQUIRE_S3,
  // Story session
  STORY_MAX_TURNS,
  STORY_SESSION_TTL_HOURS,
  STORY_MAX_CONVERSATION_TURNS,
  STORY_ENGINE_DEFAULT,
  // Polling
  SUNO_MAX_POLL_ATTEMPTS,
  SUNO_POLL_INITIAL_INTERVAL_MS,
  SUNO_POLL_MAX_INTERVAL_MS,
  REPLICATE_MAX_POLL_ATTEMPTS,
  REPLICATE_POLL_INITIAL_INTERVAL_MS,
  REPLICATE_POLL_MAX_INTERVAL_MS,
  // Render
  FFMPEG_MAX_STDERR_SIZE,
  FFMPEG_TIMEOUT_MS,
  // HTTP
  HTTP_DEFAULT_TIMEOUT_MS,
  HTTP_MAX_RETRIES,
  // Cache
  AUDIO_CACHE_MAX_AGE_SEC,
  AUDIO_CACHE_IMMUTABLE,
  // Admin
  ADMIN_SECRET_KEY,
  // Database
  DB_MAX_CONNECTIONS,
  MAX_CONCURRENT_JOBS,
};
