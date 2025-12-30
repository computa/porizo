const fs = require("fs");
const path = require("path");
const { fetchBinary, ensureDir } = require("./http");

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
  const payload = buildMusicPayload({ lyrics, musicPlan });
  const url = `${baseUrl}${endpoint}`;
  
  // ElevenLabs /v1/music returns raw audio bytes, not JSON
  const audioBuffer = await fetchBinary(
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

module.exports = {
  buildMusicPayload,
  generateMusic,
};
