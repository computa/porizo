/**
 * Voice conversion provider - routes between AI voice (Replicate RVC) and
 * personalized voice (Seed-VC) based on track.voice_mode
 *
 * Voice modes:
 * - "ai_voice" (default): Uses pre-trained RVC models via Replicate (e.g., "Squidward")
 * - "personalized" or "user_voice": Uses user's enrolled voice via Seed-VC zero-shot conversion
 */

const fs = require("fs");
const path = require("path");
const { convertVoice: replicateConvert } = require("./replicate");
const { convertVoice: seedvcConvert } = require("./seedvc");
const { writeWav } = require("../utils/audio");

/**
 * Find the best reference audio from user's enrollment
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory
 * @param {string} options.userId - User ID
 * @param {Object} options.db - Database instance (optional)
 * @returns {Promise<string|null>} Path to reference audio or null
 */
async function findReferenceAudio({ storageDir, userId, db }) {
  // Strategy 1: Find from enrollment sessions
  const enrollmentDir = path.join(storageDir, "enrollment", "raw", userId);

  if (!fs.existsSync(enrollmentDir)) {
    console.warn(`[Voice] No enrollment directory found for user ${userId}`);
    return null;
  }

  // Find the most recent session with audio chunks
  const sessions = fs.readdirSync(enrollmentDir)
    .filter(f => fs.statSync(path.join(enrollmentDir, f)).isDirectory())
    .sort()
    .reverse(); // Most recent first

  for (const sessionId of sessions) {
    const sessionDir = path.join(enrollmentDir, sessionId);
    const wavFiles = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith(".wav"))
      .sort();

    if (wavFiles.length > 0) {
      // Prefer sung samples for singing voice conversion (better voice characteristics)
      const sungFile = wavFiles.find(f => f.includes("sung"));
      const refFile = sungFile || wavFiles[0];
      const refPath = path.join(sessionDir, refFile);
      console.log(`[Voice] Found reference audio: ${refPath} (preferred sung: ${!!sungFile})`);
      return refPath;
    }
  }

  // Strategy 2: Check for clean concatenated audio
  const cleanDir = path.join(storageDir, "enrollment", "clean", userId);
  if (fs.existsSync(cleanDir)) {
    const cleanSessions = fs.readdirSync(cleanDir)
      .filter(f => fs.statSync(path.join(cleanDir, f)).isDirectory())
      .sort()
      .reverse();

    for (const sessionId of cleanSessions) {
      const cleanPath = path.join(cleanDir, sessionId, "clean.wav");
      if (fs.existsSync(cleanPath)) {
        console.log(`[Voice] Found clean reference audio: ${cleanPath}`);
        return cleanPath;
      }
    }
  }

  console.warn(`[Voice] No reference audio found for user ${userId}`);
  return null;
}

/**
 * Convert voice using appropriate provider based on voice_mode
 *
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory
 * @param {Object} options.track - Track object with id, user_id, voice_mode
 * @param {Object} options.trackVersion - Track version with version_num
 * @param {string} options.kind - "preview" or "full"
 * @param {Object} options.providerConfig - Provider configuration (replicate config)
 * @param {string} options.inputUrl - URL of guide vocal to convert
 * @param {number} options.similarityStrength - Voice similarity parameter
 * @param {Object} options.seedvcConfig - Seed-VC specific config (optional)
 * @param {Object} options.db - Database instance for voice profile lookup
 * @returns {Promise<{file: string, output_url?: string}>}
 */
async function convertVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  inputUrl,
  similarityStrength,
  seedvcConfig = {},
  db = null,
}) {
  const voiceMode = track.voice_mode || "ai_voice";

  console.log(`[Voice] Converting with mode: ${voiceMode} for track ${track.id}`);

  // Route based on voice_mode
  // Accept both "personalized" and "user_voice" for personalized voice cloning
  const isPersonalizedMode = voiceMode === "personalized" || voiceMode === "user_voice";

  if (isPersonalizedMode) {
    return convertPersonalizedVoice({
      storageDir,
      track,
      trackVersion,
      kind,
      inputUrl,
      seedvcConfig,
      db,
    });
  }

  // Default: AI voice using Replicate RVC
  return convertAiVoice({
    storageDir,
    track,
    trackVersion,
    kind,
    providerConfig,
    inputUrl,
    similarityStrength,
  });
}

/**
 * Convert using AI voice (pre-trained RVC models via Replicate)
 */
async function convertAiVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  inputUrl,
  similarityStrength,
}) {
  if (providerConfig?.live) {
    console.log(`[Voice] Using Replicate RVC for AI voice conversion`);
    return replicateConvert({
      baseUrl: providerConfig.baseUrl,
      token: providerConfig.token,
      modelVersion: providerConfig.modelVersion,
      storageDir,
      track,
      trackVersion,
      inputUrl,
      timeoutMs: providerConfig.timeoutMs,
      kind,
      similarityStrength,
    });
  }

  // Stub mode: generate placeholder
  console.log(`[Voice] Using stub mode for AI voice conversion (no live provider)`);
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "user_vocal.wav" : "user_vocal_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 4 : 10,
    frequencyHz: 330,
  });
  return { file: fileName };
}

/**
 * Convert using personalized voice (user's enrolled voice via Seed-VC)
 */
async function convertPersonalizedVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  inputUrl,
  seedvcConfig,
  db,
}) {
  // Find user's reference audio from enrollment
  const referenceAudioPath = await findReferenceAudio({
    storageDir,
    userId: track.user_id,
    db,
  });

  if (!referenceAudioPath) {
    throw new Error(
      "E302_VOICE_ERROR: No enrolled voice found for personalized mode. " +
      "User must complete voice enrollment first."
    );
  }

  // For personalized mode, we need to download the guide vocal to a local file
  // because Seed-VC (via Gradio) works with file paths
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );

  // Check if guide vocal exists locally (could be from Suno or TTS)
  const guideFileName = kind === "preview" ? "guide_vocal.mp3" : "guide_vocal_full.mp3";
  let sourceAudioPath = path.join(versionDir, guideFileName);

  // Also check for .wav version
  if (!fs.existsSync(sourceAudioPath)) {
    const guideWavName = kind === "preview" ? "guide_vocal.wav" : "guide_vocal_full.wav";
    sourceAudioPath = path.join(versionDir, guideWavName);
  }

  // If guide vocal is a URL (Suno CDN), we need to download it first
  if (!fs.existsSync(sourceAudioPath) && inputUrl) {
    console.log(`[Voice] Downloading guide vocal from ${inputUrl}`);
    const { downloadToFile } = require("./http");
    const downloadPath = path.join(versionDir, "guide_for_seedvc.mp3");
    await downloadToFile(inputUrl, downloadPath, seedvcConfig.timeoutMs || 120000);
    sourceAudioPath = downloadPath;
  }

  if (!fs.existsSync(sourceAudioPath)) {
    throw new Error(
      "E302_VOICE_ERROR: Guide vocal not found. Cannot perform personalized voice conversion."
    );
  }

  console.log(`[Voice] Using Seed-VC for personalized voice conversion`);
  console.log(`[Voice] Source: ${sourceAudioPath}`);
  console.log(`[Voice] Reference: ${referenceAudioPath}`);

  try {
    const result = await seedvcConvert({
      storageDir,
      track,
      trackVersion,
      sourceAudioPath,
      referenceAudioPath,
      timeoutMs: seedvcConfig.timeoutMs || 300000,
      kind,
      params: seedvcConfig.params || {},
      hfToken: seedvcConfig.hfToken || null,
    });

    return {
      file: result.file,
      output_path: result.output_path,
    };
  } catch (error) {
    console.error(`[Voice] Seed-VC conversion failed:`, error.message);

    // If Seed-VC fails, could fall back to AI voice or throw
    // For now, we throw so the user knows personalized mode failed
    throw new Error(`E302_VOICE_ERROR: Personalized voice conversion failed: ${error.message}`);
  }
}

module.exports = {
  convertVoice,
  findReferenceAudio,
};
