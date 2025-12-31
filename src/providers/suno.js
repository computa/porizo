const fs = require("fs");
const path = require("path");
const { fetchJson, ensureDir } = require("./http");

/**
 * Log Suno credit usage from API response
 * Third-party Suno APIs (sunoapi.org) return credit info in response body
 * @param {string} taskId - The task/generation ID
 * @param {object|null} response - API response containing credit info
 */
function logSunoCreditUsage(taskId, response) {
  if (!response) {
    console.log(`[Suno Credits] ${taskId}: response unavailable`);
    return;
  }

  const parts = [`[Suno Credits] ${taskId}:`];

  if (response.credits_used !== undefined) {
    parts.push(`used=${response.credits_used}`);
  }
  if (response.credits_remaining !== undefined) {
    parts.push(`remaining=${response.credits_remaining}`);
  }

  if (parts.length === 1) {
    parts.push("credit info not in response");
  }

  console.log(parts.join(" "));
}

/**
 * Build payload for Suno API (sunoapi.org format)
 * @param {object} options
 * @param {object|null} options.lyrics - Lyrics with title and sections
 * @param {object} options.musicPlan - Music plan with style, duration
 * @param {object} options.track - Track metadata
 * @param {boolean} [options.instrumental] - Generate instrumental only
 * @returns {object} Suno API payload
 */
function buildSunoPayload({ lyrics, musicPlan, track, instrumental }) {
  // Build prompt from lyrics or fall back to track info
  let prompt = "";

  if (lyrics && lyrics.sections && lyrics.sections.length > 0) {
    // Format lyrics with section markers for Suno
    const formattedSections = lyrics.sections.map((section) => {
      const sectionHeader = section.name ? `[${section.name}]` : "";
      const lines = section.lines ? section.lines.join("\n") : "";
      return sectionHeader ? `${sectionHeader}\n${lines}` : lines;
    });
    prompt = formattedSections.join("\n\n");
  } else if (track) {
    // Fallback to track message/recipient for context
    const parts = [];
    if (track.recipient_name) parts.push(`for ${track.recipient_name}`);
    if (track.occasion) parts.push(track.occasion);
    if (track.message) parts.push(track.message);
    prompt = parts.join(" - ") || "Generate a song";
  }

  // Get title from lyrics or track
  const title = (lyrics && lyrics.title) || (track && track.title) || "Untitled";

  // Get style from music plan
  const style = (musicPlan && musicPlan.style) || "pop";

  return {
    prompt,
    title,
    style,
    instrumental: instrumental === true,
  };
}

/**
 * Generate music using Suno API (via sunoapi.org)
 * Follows same interface as ElevenLabs generateMusic for easy switching
 *
 * @param {object} options
 * @param {string} options.baseUrl - Suno API base URL (e.g., https://api.sunoapi.org)
 * @param {string} options.apiKey - API key for authentication
 * @param {string} options.storageDir - Directory to save output files
 * @param {object} options.track - Track with id and user_id
 * @param {object} options.trackVersion - Version with version_num
 * @param {object|null} options.lyrics - Lyrics object
 * @param {object} options.musicPlan - Music plan with style, duration
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @param {string} options.kind - "preview" or "full"
 * @returns {Promise<{instrumental_file: string, vocal_file?: string, raw: object}>}
 */
async function generateMusicWithSuno({
  baseUrl,
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
    throw new Error("E302_SUNO_ERROR: API key is required");
  }
  if (!baseUrl) {
    throw new Error("E302_SUNO_ERROR: Base URL is required");
  }
  if (!track || !track.user_id || !track.id) {
    throw new Error("E302_SUNO_ERROR: Valid track with user_id and id required");
  }
  if (!trackVersion || !trackVersion.version_num) {
    throw new Error("E302_SUNO_ERROR: Valid trackVersion with version_num required");
  }

  const internalPayload = buildSunoPayload({ lyrics, musicPlan, track });
  console.log(`[Suno] Generating music for track ${track.id}, kind: ${kind}`);

  // Build API-specific payload for sunoapi.org
  const apiPayload = {
    customMode: true,
    instrumental: internalPayload.instrumental,
    model: "V4",
    prompt: internalPayload.prompt,
    style: internalPayload.style,
    title: internalPayload.title,
    // Use httpbin as dummy callback - we poll for status instead
    callBackUrl: "https://httpbin.org/post",
  };

  // Step 1: Submit generation request
  const submitUrl = `${baseUrl}/api/v1/generate`;
  console.log(`[Suno] Submitting to ${submitUrl}`);

  const submitResponse = await fetchJson(
    submitUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(apiPayload),
    },
    timeoutMs
  );

  // Response format: { code: 200, msg: "success", data: { taskId: "xxx" } }
  if (submitResponse.code !== 200) {
    throw new Error(`E302_SUNO_ERROR: API error - ${submitResponse.msg}`);
  }

  const taskId = submitResponse.data?.taskId || submitResponse.data?.task_id;
  if (!taskId) {
    throw new Error("E302_SUNO_ERROR: No task ID returned from API");
  }

  console.log(`[Suno] Task submitted: ${taskId}`);

  // Step 2: Poll for completion
  const pollIntervalMs = 5000;
  const maxPolls = Math.ceil(timeoutMs / pollIntervalMs);

  let statusResponse;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollUrl = `${baseUrl}/api/v1/generate/record-info?taskId=${taskId}`;
    statusResponse = await fetchJson(
      pollUrl,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      },
      30000
    );

    const status = statusResponse.data?.status;
    console.log(`[Suno] Polling ${i + 1}/${maxPolls}: status=${status}`);

    if (status === "SUCCESS") {
      break;
    }
    if (status === "FAILED" || status === "ERROR") {
      const errorMsg = statusResponse.data?.errorMessage || "Unknown error";
      throw new Error(`E302_SUNO_ERROR: Generation failed - ${errorMsg}`);
    }
  }

  const finalStatus = statusResponse?.data?.status;
  if (finalStatus !== "SUCCESS") {
    throw new Error("E302_SUNO_ERROR: Generation timed out");
  }

  // Log credit usage
  logSunoCreditUsage(taskId, statusResponse);

  // Step 3: Extract audio URL and download
  // Response format: { data: { response: { sunoData: [{ audioUrl, sourceAudioUrl, ... }] } } }
  const sunoData = statusResponse.data?.response?.sunoData;
  if (!sunoData || sunoData.length === 0) {
    throw new Error("E302_SUNO_ERROR: No audio data in response");
  }

  // Use the first generated track (Suno generates 2 songs per request)
  const firstTrack = sunoData[0];
  const audioUrl = firstTrack.sourceAudioUrl || firstTrack.audioUrl;
  if (!audioUrl) {
    throw new Error("E302_SUNO_ERROR: No audio URL in response");
  }

  console.log(`[Suno] Downloading audio from: ${audioUrl}`);

  // Download the audio file
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  ensureDir(versionDir);

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`E302_SUNO_ERROR: Failed to download audio - ${audioResponse.status}`);
  }
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

  const instName = kind === "preview" ? "inst_preview.mp3" : "inst_full.mp3";
  fs.writeFileSync(path.join(versionDir, instName), audioBuffer);

  console.log(`[Suno] Saved ${audioBuffer.length} bytes to ${instName}`);
  console.log(`[Suno] Duration: ${firstTrack.duration}s, Model: ${firstTrack.modelName}`);

  return {
    instrumental_file: instName,
    vocal_file: null, // Suno generates combined audio (music + vocals)
    raw: {
      task_id: taskId,
      audio_url: audioUrl,
      // Suno generates combined audio - use same URL for voice conversion input
      guide_vocal_url: audioUrl,
      instrumental_url: audioUrl,
      duration: firstTrack.duration,
      model: firstTrack.modelName,
      // Include second track URL in case we want to offer alternatives
      alt_audio_url: sunoData[1]?.sourceAudioUrl || sunoData[1]?.audioUrl,
    },
  };
}

module.exports = {
  buildSunoPayload,
  generateMusicWithSuno,
  logSunoCreditUsage,
};
