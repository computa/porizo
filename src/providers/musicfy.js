/**
 * Musicfy Provider - AI Voice Conversion for Singing
 *
 * Commercial API for converting audio to different voices.
 * Pricing: $0.07/minute of generated audio.
 *
 * @see https://docs.musicfy.lol/
 */

const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const { ensureDir, downloadToFile } = require("./http");

const MUSICFY_API_BASE = "https://api.musicfy.lol";

/**
 * Get available voices from Musicfy
 * @param {string} apiKey - Musicfy API key
 * @returns {Promise<Array<{voice_id: string, name: string}>>}
 */
async function getVoices(apiKey) {
  const response = await fetch(`${MUSICFY_API_BASE}/voices`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`E303_MUSICFY_ERROR: Failed to get voices: ${error}`);
  }

  const data = await response.json();
  return data.voices || data;
}

/**
 * Convert voice using Musicfy API
 *
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory
 * @param {Object} options.track - Track object with id, user_id
 * @param {Object} options.trackVersion - Track version with version_num
 * @param {string} options.sourceAudioPath - Path to source audio (vocals to convert)
 * @param {string} options.voiceId - Musicfy voice ID to convert to
 * @param {string} options.apiKey - Musicfy API key
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @param {string} options.kind - "preview" or "full"
 * @returns {Promise<{file: string, output_path: string}>}
 */
async function convertVoice({
  storageDir,
  track,
  trackVersion,
  sourceAudioPath,
  voiceId,
  apiKey,
  timeoutMs = 300000,
  kind = "preview",
}) {
  if (!track || !track.user_id || !track.id) {
    throw new Error("E303_MUSICFY_ERROR: Valid track with user_id and id required");
  }
  if (!trackVersion || !trackVersion.version_num) {
    throw new Error("E303_MUSICFY_ERROR: Valid trackVersion with version_num required");
  }
  if (!sourceAudioPath) {
    throw new Error("E303_MUSICFY_ERROR: Source audio path is required");
  }
  if (!voiceId) {
    throw new Error("E303_MUSICFY_ERROR: Voice ID is required");
  }
  if (!apiKey) {
    throw new Error("E303_MUSICFY_ERROR: API key is required");
  }

  if (!fs.existsSync(sourceAudioPath)) {
    throw new Error(`E303_MUSICFY_ERROR: Source audio not found: ${sourceAudioPath}`);
  }

  console.log(`[Musicfy] Starting voice conversion for track ${track.id}`);
  console.log(`[Musicfy] Source: ${sourceAudioPath}`);
  console.log(`[Musicfy] Voice ID: ${voiceId}`);

  try {
    const form = new FormData();
    form.append("audio", fs.createReadStream(sourceAudioPath));
    form.append("voice_id", voiceId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${MUSICFY_API_BASE}/convert`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Musicfy] API error: ${response.status} - ${error}`);
      throw new Error(`E303_MUSICFY_ERROR: API returned ${response.status}: ${error}`);
    }

    const result = await response.json();
    console.log(`[Musicfy] Conversion complete for track ${track.id}`);

    // Prepare output directory
    const versionDir = path.join(
      storageDir,
      "tracks",
      track.user_id,
      track.id,
      `v${trackVersion.version_num}`
    );
    ensureDir(versionDir);

    const fileName = kind === "preview" ? "user_vocal.wav" : "user_vocal_full.wav";
    const outputPath = path.join(versionDir, fileName);

    // Download the converted audio
    const audioUrl = result.audio_url || result.url || result.output;
    if (!audioUrl) {
      console.error("[Musicfy] Unexpected response format:", result);
      throw new Error("E303_MUSICFY_ERROR: No audio URL in response");
    }

    console.log(`[Musicfy] Downloading from: ${audioUrl.substring(0, 80)}...`);
    await downloadToFile(audioUrl, outputPath, timeoutMs);

    console.log(`[Musicfy] Saved converted audio to ${outputPath}`);

    return {
      file: fileName,
      output_path: outputPath,
    };
  } catch (error) {
    if (error.message && error.message.includes("MUSICFY")) {
      throw error;
    }

    console.error(`[Musicfy] Voice conversion failed for track ${track.id}:`, error.message);

    if (error.name === "AbortError") {
      throw new Error("E303_MUSICFY_ERROR: Voice conversion timed out");
    }

    throw new Error(`E303_MUSICFY_ERROR: ${error.message}`);
  }
}

/**
 * Check if Musicfy service is available
 * @param {string} apiKey - Musicfy API key
 * @returns {Promise<boolean>}
 */
async function checkAvailability(apiKey) {
  try {
    await getVoices(apiKey);
    return true;
  } catch (error) {
    console.warn("[Musicfy] Service check failed:", error.message);
    return false;
  }
}

module.exports = {
  convertVoice,
  getVoices,
  checkAvailability,
  MUSICFY_API_BASE,
};
