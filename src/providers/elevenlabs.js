const fs = require("fs");
const path = require("path");
const { fetchBinaryWithHeaders, ensureDir } = require("./http");

/**
 * Log ElevenLabs credit usage from API response headers
 * @param {string} operation - The operation type (music_generation, tts)
 * @param {Headers|Map|null|undefined} headers - Response headers
 */
function logCreditUsage(operation, headers) {
  if (!headers) {
    console.log(`[ElevenLabs Credits] ${operation}: headers unavailable`);
    return;
  }

  // Headers can be a fetch Headers object or a Map (for testing)
  const get = (key) => {
    if (typeof headers.get === "function") {
      return headers.get(key);
    }
    return null;
  };

  const creditsRemaining = get("x-credits-remaining") || get("credits-remaining");
  const characterCount = get("x-character-count") || get("character-count");
  const creditsUsed = get("x-credits-used") || get("credits-used");

  const parts = [`[ElevenLabs Credits] ${operation}:`];

  if (creditsUsed) {
    parts.push(`used=${creditsUsed}`);
  }
  if (creditsRemaining) {
    parts.push(`remaining=${creditsRemaining}`);
  }
  if (characterCount) {
    parts.push(`chars=${characterCount}`);
  }

  if (parts.length === 1) {
    parts.push("credit info not in response headers");
  }

  console.log(parts.join(" "));
}

/**
 * Build payload for ElevenLabs Music API (/v1/music)
 * Uses correct API format: music_length_ms, model_id, force_instrumental
 */
function buildMusicPayload({ lyrics, musicPlan }) {
  // Build prompt from lyrics
  let prompt = "Generate a short instrumental";
  if (lyrics) {
    const parts = [];
    if (lyrics.title) parts.push(lyrics.title);
    if (lyrics.anchor_line) parts.push(lyrics.anchor_line);
    if (musicPlan && musicPlan.style) parts.push(musicPlan.style + " style");
    if (parts.length > 0) {
      prompt = parts.join(" - ");
    }
  }

  // Default duration: 60 seconds
  const durationSec = (musicPlan && musicPlan.duration_sec) || 60;

  return {
    prompt: prompt,
    music_length_ms: durationSec * 1000,
    model_id: "music_v1",
    force_instrumental: true,
  };
}

async function generateMusic({
  baseUrl,
  endpoint,
  apiKey,
  storageDir,
  track,
  trackVersion,
  lyrics,
  musicPlan,
  timeoutMs,
  kind,
}) {
  // Input validation
  if (!apiKey) {
    throw new Error("E301_ELEVENLABS_ERROR: API key is required");
  }
  if (!baseUrl) {
    throw new Error("E301_ELEVENLABS_ERROR: Base URL is required");
  }
  if (!track || !track.user_id || !track.id) {
    throw new Error("E301_ELEVENLABS_ERROR: Valid track with user_id and id required");
  }
  if (!trackVersion || !trackVersion.version_num) {
    throw new Error("E301_ELEVENLABS_ERROR: Valid trackVersion with version_num required");
  }

  const payload = buildMusicPayload({ lyrics, musicPlan });
  const url = `${baseUrl}${endpoint}`;
  console.log(`[ElevenLabs] Generating music for track ${track.id}, kind: ${kind}`);

  // ElevenLabs /v1/music returns raw audio bytes, not JSON
  const { buffer: audioBuffer, headers } = await fetchBinaryWithHeaders(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "audio/mpeg",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  // Log credit usage for cost tracking
  logCreditUsage("music_generation", headers);

  // Response validation
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("E301_ELEVENLABS_ERROR: Empty audio response from API");
  }
  if (audioBuffer.length < 1000) {
    // MP3 files should be at least a few KB
    console.warn(`[ElevenLabs] Suspiciously small audio response: ${audioBuffer.length} bytes`);
  }
  console.log(`[ElevenLabs] Received ${audioBuffer.length} bytes of audio for track ${track.id}`);

  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  ensureDir(versionDir);
  const instName = kind === "preview" ? "inst_preview.mp3" : "inst_full.mp3";

  fs.writeFileSync(path.join(versionDir, instName), audioBuffer);

  return {
    instrumental_file: instName,
    raw: {
      instrumental_url: null, // File saved locally, no URL
      guide_vocal_url: null,
    },
  };
}

/**
 * Convert lyrics to spoken text for TTS
 * @param {Object} lyrics - Lyrics object with sections
 * @param {Object} options - Options for extraction
 * @param {boolean} options.chorusOnly - If true, only extract chorus section (for preview)
 * Extracts all lines from lyrics sections and joins them
 */
function lyricsToText(lyrics, { chorusOnly = false } = {}) {
  if (!lyrics || !lyrics.sections) {
    return null;
  }
  const lines = [];
  for (const section of lyrics.sections) {
    // For preview, only use chorus section to reduce TTS costs
    if (chorusOnly && section.name !== "chorus") {
      continue;
    }
    if (section.lines && Array.isArray(section.lines)) {
      lines.push(...section.lines);
    }
  }
  return lines.length > 0 ? lines.join(". ") : null;
}

/**
 * Generate speech from text using ElevenLabs TTS API
 * POST /v1/text-to-speech/{voice_id}
 */
async function generateSpeech({
  baseUrl,
  apiKey,
  voiceId,
  text,
  outputPath,
  timeoutMs,
}) {
  if (!text || !voiceId) {
    throw new Error("E301_TTS_ERROR: TTS requires text and voiceId");
  }
  if (!apiKey) {
    throw new Error("E301_TTS_ERROR: API key is required");
  }
  if (!baseUrl) {
    throw new Error("E301_TTS_ERROR: Base URL is required");
  }

  console.log(`[ElevenLabs] Generating TTS with voice ${voiceId}, text length: ${text.length}`);
  const url = `${baseUrl}/v1/text-to-speech/${voiceId}`;

  const payload = {
    text: text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  };

  const { buffer: audioBuffer, headers } = await fetchBinaryWithHeaders(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  // Log credit usage for cost tracking
  logCreditUsage("tts_generation", headers);

  // Response validation
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("E301_TTS_ERROR: Empty audio response from TTS API");
  }
  console.log(`[ElevenLabs] TTS generated ${audioBuffer.length} bytes`);

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, audioBuffer);

  return { file: path.basename(outputPath) };
}

module.exports = {
  buildMusicPayload,
  generateMusic,
  generateSpeech,
  lyricsToText,
  logCreditUsage,
};
