/**
 * ElevenLabs Voice Provider - Voice Cloning + Speech-to-Speech Conversion
 *
 * Creates Instant Voice Clones from enrollment audio and converts
 * guide vocals to the user's voice using the Voice Changer API.
 *
 * @see https://elevenlabs.io/docs/api-reference/voices/add
 * @see https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
 */

const fs = require("fs");
const path = require("path");
const { ensureDir } = require("./http");

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

/**
 * Create an Instant Voice Clone from audio file
 *
 * @param {Object} options
 * @param {string} options.apiKey - ElevenLabs API key
 * @param {string} options.audioPath - Path to audio file (WAV/MP3, ~1 min recommended)
 * @param {string} options.name - Name for the voice clone
 * @param {string} options.description - Optional description
 * @returns {Promise<{voice_id: string, name: string}>}
 */
async function createVoiceClone({ apiKey, audioPath, name, description = "" }) {
  if (!apiKey) {
    throw new Error("E305_ELEVENLABS_VOICE_ERROR: API key is required");
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`E305_ELEVENLABS_VOICE_ERROR: Audio file not found: ${audioPath}`);
  }
  if (!name) {
    throw new Error("E305_ELEVENLABS_VOICE_ERROR: Voice name is required");
  }

  console.log(`[ElevenLabs:Voice] Creating voice clone "${name}" from ${path.basename(audioPath)}`);

  const form = new FormData();
  form.append("name", name);
  const audioBuffer = fs.readFileSync(audioPath);
  form.append("files", new Blob([audioBuffer], { type: "audio/wav" }), path.basename(audioPath));
  if (description) {
    form.append("description", description);
  }
  form.append("remove_background_noise", "true");

  const response = await fetch(`${ELEVENLABS_API_BASE}/v1/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[ElevenLabs:Voice] Clone creation failed: ${response.status} - ${errorText}`);
    throw new Error(`E305_ELEVENLABS_VOICE_ERROR: Failed to create voice clone: ${response.status}`);
  }

  const result = await response.json();
  console.log(`[ElevenLabs:Voice] Voice clone created: ${result.voice_id}`);

  return {
    voice_id: result.voice_id,
    name: result.name || name,
  };
}

/**
 * Delete a voice clone
 *
 * @param {Object} options
 * @param {string} options.apiKey - ElevenLabs API key
 * @param {string} options.voiceId - Voice ID to delete
 * @returns {Promise<boolean>}
 */
async function deleteVoiceClone({ apiKey, voiceId }) {
  if (!apiKey || !voiceId) {
    return false;
  }

  console.log(`[ElevenLabs:Voice] Deleting voice clone: ${voiceId}`);

  try {
    const response = await fetch(`${ELEVENLABS_API_BASE}/v1/voices/${voiceId}`, {
      method: "DELETE",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (response.ok) {
      console.log(`[ElevenLabs:Voice] Voice clone deleted: ${voiceId}`);
      return true;
    }

    console.warn(`[ElevenLabs:Voice] Delete failed: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`[ElevenLabs:Voice] Delete error:`, error.message);
    return false;
  }
}

/**
 * Convert audio using Speech-to-Speech (Voice Changer)
 *
 * Takes source audio and converts it to sound like the target voice
 * while preserving timing, emotion, and expression.
 *
 * @param {Object} options
 * @param {string} options.apiKey - ElevenLabs API key
 * @param {string} options.voiceId - Target voice ID (from createVoiceClone)
 * @param {string} options.sourceAudioPath - Path to source audio (guide vocal)
 * @param {string} options.outputPath - Path to save converted audio
 * @param {number} options.timeoutMs - Request timeout
 * @param {Object} options.settings - Optional voice settings
 * @returns {Promise<{file: string, output_path: string}>}
 */
async function convertVoice({
  apiKey,
  voiceId,
  sourceAudioPath,
  outputPath,
  timeoutMs = 300000,
  settings = {},
}) {
  if (!apiKey) {
    throw new Error("E305_ELEVENLABS_VOICE_ERROR: API key is required");
  }
  if (!voiceId) {
    throw new Error("E305_ELEVENLABS_VOICE_ERROR: Voice ID is required");
  }
  if (!sourceAudioPath || !fs.existsSync(sourceAudioPath)) {
    throw new Error(`E305_ELEVENLABS_VOICE_ERROR: Source audio not found: ${sourceAudioPath}`);
  }

  console.log(`[ElevenLabs:Voice] Converting audio to voice ${voiceId}`);
  console.log(`[ElevenLabs:Voice] Source: ${sourceAudioPath}`);

  const form = new FormData();
  const audioBuffer = fs.readFileSync(sourceAudioPath);
  form.append("audio", new Blob([audioBuffer], { type: "audio/wav" }), path.basename(sourceAudioPath));
  // Model: eleven_multilingual_sts_v2 is recommended even for English
  form.append("model_id", settings.modelId || "eleven_multilingual_sts_v2");
  // Remove background noise from source
  form.append("remove_background_noise", String(settings.removeBackgroundNoise ?? true));

  // Voice settings for consistency
  if (settings.stability !== undefined) {
    form.append("voice_settings", JSON.stringify({
      stability: settings.stability ?? 1.0,  // Max stability for consistent voice
      similarity_boost: settings.similarityBoost ?? 0.75,
    }));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${ELEVENLABS_API_BASE}/v1/speech-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
        },
        body: form,
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabs:Voice] Conversion failed: ${response.status} - ${errorText}`);
      throw new Error(`E305_ELEVENLABS_VOICE_ERROR: Voice conversion failed: ${response.status}`);
    }

    // Response is audio binary
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("E305_ELEVENLABS_VOICE_ERROR: Empty audio response");
    }

    console.log(`[ElevenLabs:Voice] Received ${audioBuffer.length} bytes`);

    // Save to output path
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, audioBuffer);

    console.log(`[ElevenLabs:Voice] Saved converted audio to ${outputPath}`);

    return {
      file: path.basename(outputPath),
      output_path: outputPath,
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === "AbortError") {
      throw new Error("E305_ELEVENLABS_VOICE_ERROR: Voice conversion timed out");
    }

    if (error.message?.includes("E305_ELEVENLABS")) {
      throw error;
    }

    throw new Error(`E305_ELEVENLABS_VOICE_ERROR: ${error.message}`);
  }
}

/**
 * Get list of available voices (for debugging/admin)
 *
 * @param {string} apiKey - ElevenLabs API key
 * @returns {Promise<Array>}
 */
async function getVoices(apiKey) {
  const response = await fetch(`${ELEVENLABS_API_BASE}/v1/voices`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Failed to get voices: ${response.status}`);
  }

  const data = await response.json();
  return data.voices || [];
}

module.exports = {
  createVoiceClone,
  deleteVoiceClone,
  convertVoice,
  getVoices,
  ELEVENLABS_API_BASE,
};
