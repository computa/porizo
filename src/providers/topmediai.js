/**
 * TopMediai Provider - AI Voice Change & Song Cover
 *
 * Commercial API for voice conversion optimized for singing/covers.
 *
 * @see https://docs.topmediai.com/
 */

const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const { ensureDir, downloadToFile } = require("./http");

const TOPMEDIAI_API_BASE = "https://api.topmediai.com/v1";

/**
 * Get available voices from TopMediai
 * @param {string} apiKey - TopMediai API key
 * @returns {Promise<Array<{voice_id: number, voice_name: string, mode: number}>>}
 */
async function getVoices(apiKey) {
  const response = await fetch(`${TOPMEDIAI_API_BASE}/voices`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`E304_TOPMEDIAI_ERROR: Failed to get voices: ${error}`);
  }

  const data = await response.json();
  return data.Voices || data.voices || data;
}

/**
 * Convert voice using TopMediai Voice Change API
 *
 * @param {Object} options
 * @param {string} options.storageDir - Base storage directory
 * @param {Object} options.track - Track object with id, user_id
 * @param {Object} options.trackVersion - Track version with version_num
 * @param {string} options.sourceAudioPath - Path to source audio (vocals to convert)
 * @param {number} options.voiceId - TopMediai voice ID
 * @param {number} options.mode - Mode corresponding to voice ID
 * @param {string} options.apiKey - TopMediai API key
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
  mode = 1,
  apiKey,
  timeoutMs = 300000,
  kind = "preview",
}) {
  if (!track || !track.user_id || !track.id) {
    throw new Error("E304_TOPMEDIAI_ERROR: Valid track with user_id and id required");
  }
  if (!trackVersion || !trackVersion.version_num) {
    throw new Error("E304_TOPMEDIAI_ERROR: Valid trackVersion with version_num required");
  }
  if (!sourceAudioPath) {
    throw new Error("E304_TOPMEDIAI_ERROR: Source audio path is required");
  }
  if (!voiceId) {
    throw new Error("E304_TOPMEDIAI_ERROR: Voice ID is required");
  }
  if (!apiKey) {
    throw new Error("E304_TOPMEDIAI_ERROR: API key is required");
  }

  if (!fs.existsSync(sourceAudioPath)) {
    throw new Error(`E304_TOPMEDIAI_ERROR: Source audio not found: ${sourceAudioPath}`);
  }

  console.log(`[TopMediai] Starting voice conversion for track ${track.id}`);
  console.log(`[TopMediai] Source: ${sourceAudioPath}`);
  console.log(`[TopMediai] Voice ID: ${voiceId}, Mode: ${mode}`);

  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(sourceAudioPath));
    form.append("voice_id", voiceId.toString());
    form.append("mode", mode.toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${TOPMEDIAI_API_BASE}/voice_change`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        ...form.getHeaders(),
      },
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[TopMediai] API error: ${response.status} - ${error}`);
      throw new Error(`E304_TOPMEDIAI_ERROR: API returned ${response.status}: ${error}`);
    }

    const result = await response.json();
    console.log(`[TopMediai] Conversion complete for track ${track.id}`);

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

    // Download the converted audio - TopMediai may return URL or base64
    const audioUrl = result.audio_url || result.url || result.output || result.data?.url;
    if (audioUrl) {
      console.log(`[TopMediai] Downloading from: ${audioUrl.substring(0, 80)}...`);
      await downloadToFile(audioUrl, outputPath, timeoutMs);
    } else if (result.audio || result.data) {
      // Handle base64 response
      const audioData = result.audio || result.data;
      if (typeof audioData === "string" && audioData.length > 1000) {
        const buffer = Buffer.from(audioData, "base64");
        fs.writeFileSync(outputPath, buffer);
      } else {
        console.error("[TopMediai] Unexpected response format:", result);
        throw new Error("E304_TOPMEDIAI_ERROR: No audio data in response");
      }
    } else {
      console.error("[TopMediai] Unexpected response format:", result);
      throw new Error("E304_TOPMEDIAI_ERROR: No audio URL or data in response");
    }

    console.log(`[TopMediai] Saved converted audio to ${outputPath}`);

    return {
      file: fileName,
      output_path: outputPath,
    };
  } catch (error) {
    if (error.message && error.message.includes("TOPMEDIAI")) {
      throw error;
    }

    console.error(`[TopMediai] Voice conversion failed for track ${track.id}:`, error.message);

    if (error.name === "AbortError") {
      throw new Error("E304_TOPMEDIAI_ERROR: Voice conversion timed out");
    }

    throw new Error(`E304_TOPMEDIAI_ERROR: ${error.message}`);
  }
}

/**
 * Check if TopMediai service is available
 * @param {string} apiKey - TopMediai API key
 * @returns {Promise<boolean>}
 */
async function checkAvailability(apiKey) {
  try {
    await getVoices(apiKey);
    return true;
  } catch (error) {
    console.warn("[TopMediai] Service check failed:", error.message);
    return false;
  }
}

module.exports = {
  convertVoice,
  getVoices,
  checkAvailability,
  TOPMEDIAI_API_BASE,
};
