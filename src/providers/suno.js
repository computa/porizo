const fs = require("fs");
const path = require("path");
const { fetchJson, ensureDir } = require("./http");
const { pollWithBackoff, createPollingConfig } = require("../utils/polling");
const { normalizeStyle, getStyle } = require("./style-registry");

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const MERGED_TENS_WORD_REGEX =
  /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]?(one|two|three|four|five|six|seven|eight|nine)\b/gi;
const AGE_NUMBER_REGEX = /\b(\d{1,3})\s*(years?\s*old|years?|yrs?)\b/gi;
const POLICY_ERROR_PATTERNS = ["producer tag", "specific artists", "sensitive_word_error"];

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

function numberToWords(value) {
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    return String(value);
  }
  if (value < 10) {
    return ONES[value];
  }
  if (value < 20) {
    return TEENS[value - 10];
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
  }
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (rest === 0) {
    return `${ONES[hundreds]} hundred`;
  }
  return `${ONES[hundreds]} hundred ${numberToWords(rest)}`;
}

function isSunoPolicyError(rawMessage) {
  if (!rawMessage) return false;
  const message = String(rawMessage).toLowerCase();
  return POLICY_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function sanitizeLyricLineForSunoPolicy(line, { aggressive = false } = {}) {
  if (typeof line !== "string" || !line.trim()) {
    return { line, changed: false };
  }

  let sanitized = line;

  sanitized = sanitized.replace(MERGED_TENS_WORD_REGEX, (_, tens, ones) => `${tens} ${ones}`);

  sanitized = sanitized.replace(AGE_NUMBER_REGEX, (match, rawNumber) => {
    const age = Number(rawNumber);
    if (!Number.isFinite(age) || age < 1 || age > 125) {
      return match;
    }
    return `${numberToWords(age)} years old`;
  });

  if (aggressive) {
    sanitized = sanitized.replace(/\b(\d{2,3})\b/g, (match, numericToken) => {
      const value = Number(numericToken);
      if (!Number.isFinite(value) || value < 1 || value > 125) {
        return match;
      }
      return `${numberToWords(value)} years old`;
    });
  }

  return { line: sanitized, changed: sanitized !== line };
}

function sanitizeLyricsForSunoPolicy(lyrics, options = {}) {
  if (!lyrics || !Array.isArray(lyrics.sections)) {
    return { lyrics, changed: false, changedLines: 0 };
  }

  let changed = false;
  let changedLines = 0;
  const titleResult =
    typeof lyrics.title === "string"
      ? sanitizeLyricLineForSunoPolicy(lyrics.title, options)
      : null;
  if (titleResult?.changed) {
    changed = true;
  }

  const anchorLineSnakeResult =
    typeof lyrics.anchor_line === "string"
      ? sanitizeLyricLineForSunoPolicy(lyrics.anchor_line, options)
      : null;
  if (anchorLineSnakeResult?.changed) {
    changed = true;
  }

  const anchorLineCamelResult =
    typeof lyrics.anchorLine === "string"
      ? sanitizeLyricLineForSunoPolicy(lyrics.anchorLine, options)
      : null;
  if (anchorLineCamelResult?.changed) {
    changed = true;
  }

  const sanitizedSections = lyrics.sections.map((section) => {
    if (!section || !Array.isArray(section.lines)) {
      return section;
    }
    const nextLines = section.lines.map((line) => {
      const result = sanitizeLyricLineForSunoPolicy(line, options);
      if (result.changed) {
        changed = true;
        changedLines += 1;
      }
      return result.line;
    });
    return {
      ...section,
      lines: nextLines,
    };
  });

  if (!changed) {
    return { lyrics, changed: false, changedLines: 0 };
  }

  const sanitizedLyrics = {
    ...lyrics,
    sections: sanitizedSections,
  };
  if (titleResult) {
    sanitizedLyrics.title = titleResult.line;
  }
  if (anchorLineSnakeResult) {
    sanitizedLyrics.anchor_line = anchorLineSnakeResult.line;
  }
  if (anchorLineCamelResult) {
    sanitizedLyrics.anchorLine = anchorLineCamelResult.line;
  }

  return {
    lyrics: sanitizedLyrics,
    changed: true,
    changedLines,
  };
}

/**
 * Build a rich style descriptor for Suno's `style` field from registry data.
 * Suno v4.5 expects concise genre descriptors (4-7 terms), not verbose specs.
 * Truncates to maxLen to respect API limits (1000 chars for V4_5).
 */
function buildSunoStyleField(styleKey, musicPlan, maxLen = 200) {
  const normalized = normalizeStyle(styleKey) || "pop";
  const styleDef = getStyle(normalized);
  const providerHint =
    musicPlan?.provider_style_hint ||
    styleDef.suno?.hint ||
    styleDef.suno?.instruction_override ||
    null;
  const compactPrompt =
    musicPlan?.style_prompt_compact ||
    styleDef.prompt ||
    `${normalized.replace(/_/g, " ")} arrangement`;
  const negativeConstraints = Array.isArray(musicPlan?.style_negative_constraints)
    ? musicPlan.style_negative_constraints
    : Array.isArray(styleDef.suno?.negative_constraints)
      ? styleDef.suno.negative_constraints
      : [];

  const parts = [compactPrompt];
  if (providerHint && !compactPrompt.toLowerCase().includes(String(providerHint).toLowerCase())) {
    parts.push(providerHint);
  }
  if (negativeConstraints.length > 0) {
    parts.push(`Avoid: ${negativeConstraints.slice(0, 6).join(", ")}`);
  }
  return parts.join(". ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * Build payload for Suno API (sunoapi.org format).
 *
 * Key fix: style field carries rich genre descriptors, prompt field carries
 * lyrics ONLY (no STYLE GUIDE prefix). This matches Suno's API contract
 * where `style` = sonic identity and `prompt` = lyrics/generation guidance.
 *
 * @param {object} options
 * @param {object|null} options.lyrics - Lyrics with title and sections
 * @param {object} options.musicPlan - Music plan with style, duration
 * @param {object} options.track - Track metadata
 * @param {boolean} [options.instrumental] - Generate instrumental only
 * @returns {object} Suno API payload
 */
function buildSunoPayload({ lyrics, musicPlan, track, instrumental }) {
  const styleKey = (musicPlan && musicPlan.style) || "pop";
  const style = buildSunoStyleField(styleKey, musicPlan);

  // Build prompt from lyrics ONLY — no style directives
  let prompt = "";

  if (lyrics && lyrics.sections && lyrics.sections.length > 0) {
    const formattedSections = lyrics.sections.map((section) => {
      const sectionHeader = section.name ? `[${section.name}]` : "";
      const lines = section.lines ? section.lines.join("\n") : "";
      return sectionHeader ? `${sectionHeader}\n${lines}` : lines;
    });
    prompt = formattedSections.join("\n\n");
  } else if (track) {
    const parts = [];
    if (track.recipient_name) parts.push(`for ${track.recipient_name}`);
    if (track.occasion) parts.push(track.occasion);
    if (track.message) parts.push(track.message);
    prompt = parts.join(" - ") || "Generate a song";
  }

  const titleSource = (lyrics && lyrics.title) || (track && track.title) || "Untitled";
  const title = sanitizeLyricLineForSunoPolicy(titleSource).line;

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
 * @param {Function} [options.onTaskId] - Callback to persist task id
 * @returns {Promise<{instrumental_file: string, vocal_file?: string, raw: object}>}
 */
function validateSunoInput({ apiKey, baseUrl, track, trackVersion }) {
  if (!apiKey) {
    throw new Error("E302_SUNO_ERROR: API key is required");
  }
  if (!baseUrl) {
    throw new Error("E302_SUNO_ERROR: Base URL is required");
  }
  if (!track || !track.user_id || !track.id) {
    throw new Error("E302_SUNO_ERROR: Valid track with user_id and id required");
  }
  if (trackVersion && !trackVersion.version_num) {
    throw new Error("E302_SUNO_ERROR: Valid trackVersion with version_num required");
  }
}

async function submitSunoTask({
  baseUrl,
  apiKey,
  lyrics,
  musicPlan,
  track,
  timeoutMs,
  onTaskId,
}) {
  validateSunoInput({ apiKey, baseUrl, track });
  const internalPayload = buildSunoPayload({ lyrics, musicPlan, track });
  const apiPayload = {
    customMode: true,
    instrumental: internalPayload.instrumental,
    model: "V4_5",
    prompt: internalPayload.prompt,
    style: internalPayload.style,
    title: internalPayload.title,
    // Use httpbin as dummy callback - we poll for status instead
    callBackUrl: "https://httpbin.org/post",
  };

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
  if (submitResponse.code !== 200) {
    throw new Error(`E302_SUNO_ERROR: API error - ${submitResponse.msg}`);
  }
  const taskId = submitResponse.data?.taskId || submitResponse.data?.task_id;
  if (!taskId) {
    throw new Error("E302_SUNO_ERROR: No task ID returned from API");
  }
  console.log(`[Suno] Task submitted: ${taskId}`);
  if (typeof onTaskId === "function") {
    try {
      onTaskId(taskId);
    } catch (err) {
      console.warn(`[Suno] Failed to persist task id ${taskId}:`, err.message || err);
    }
  }
  return taskId;
}

async function pollSunoTaskOnce({ baseUrl, apiKey, taskId, timeoutMs, onHeartbeat }) {
  if (typeof onHeartbeat === "function") {
    onHeartbeat();
  }
  const pollUrl = `${baseUrl}/api/v1/generate/record-info?taskId=${taskId}`;
  const statusResponse = await fetchJson(
    pollUrl,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    },
    timeoutMs
  );
  if (typeof onHeartbeat === "function") {
    onHeartbeat();
  }
  const status = statusResponse.data?.status;
  return { status, response: statusResponse };
}

function isSunoSuccessStatus(status) {
  return typeof status === "string" && status.endsWith("SUCCESS");
}

function extractSunoTrack(statusResponse) {
  const sunoData = statusResponse.data?.response?.sunoData;
  if (!sunoData || sunoData.length === 0) {
    throw new Error("E302_SUNO_ERROR: No audio data in response");
  }
  const firstTrack = sunoData[0];
  const audioUrl = firstTrack.sourceAudioUrl || firstTrack.audioUrl;
  if (!audioUrl) {
    throw new Error("E302_SUNO_ERROR: No audio URL in response");
  }
  return { sunoData, firstTrack, audioUrl };
}

async function downloadSunoAudio({ storageDir, track, trackVersion, kind, statusResponse }) {
  const { sunoData, firstTrack, audioUrl } = extractSunoTrack(statusResponse);
  console.log(`[Suno] Downloading audio from: ${audioUrl}`);

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
      audio_url: audioUrl,
      guide_vocal_url: audioUrl,
      instrumental_url: audioUrl,
      duration: firstTrack.duration,
      model: firstTrack.modelName,
      alt_audio_url: sunoData[1]?.sourceAudioUrl || sunoData[1]?.audioUrl,
    },
  };
}

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
  onTaskId,
  onHeartbeat,
}) {
  validateSunoInput({ apiKey, baseUrl, track, trackVersion });
  console.log(`[Suno] Generating music for track ${track.id}, kind: ${kind}`);

  const taskId = await submitSunoTask({
    baseUrl,
    apiKey,
    lyrics,
    musicPlan,
    track,
    timeoutMs,
    onTaskId,
  });

  // Use exponential backoff polling
  const pollingConfig = createPollingConfig("suno");
  let statusResponse;

  // Derive max attempts from timeoutMs if provided
  // Average interval approximation: (initial + max) / 2 = (5000 + 30000) / 2 = 17500ms
  const avgIntervalMs = (pollingConfig.initialIntervalMs + pollingConfig.maxIntervalMs) / 2;
  const derivedMaxAttempts = timeoutMs
    ? Math.max(5, Math.ceil(timeoutMs / avgIntervalMs))
    : pollingConfig.maxAttempts;

  try {
    const pollResult = await pollWithBackoff(
      async () => {
        const result = await pollSunoTaskOnce({
          baseUrl,
          apiKey,
          taskId,
          timeoutMs: 30000,
          onHeartbeat,
        });
        const status = result.status;

        if (isSunoSuccessStatus(status)) {
          return { done: true, response: result.response, status };
        }
        if (status === "FAILED" || status === "ERROR") {
          const errorMsg = result.response?.data?.errorMessage || "Unknown error";
          return { done: false, failed: true, error: `E302_SUNO_ERROR: Generation failed - ${errorMsg}` };
        }
        return { done: false, response: result.response, status };
      },
      {
        ...pollingConfig,
        maxAttempts: derivedMaxAttempts,
        onPoll: (attempt, interval) => {
          console.log(`[Suno] Polling task ${taskId}, attempt ${attempt}/${derivedMaxAttempts}, next interval: ${interval}ms`);
        },
      }
    );
    statusResponse = pollResult.response;
  } catch (pollErr) {
    // Re-throw if already a Suno error (preserves original context)
    if (pollErr?.message?.includes("E302_SUNO_ERROR")) {
      throw pollErr;
    }
    const errMessage = pollErr?.message ?? String(pollErr || "unknown error");
    const isTimeout = errMessage.includes("exceeded") || errMessage.includes("Polling timeout");
    throw new Error(`E302_SUNO_ERROR: task=${taskId}, ${isTimeout ? "Generation timed out" : errMessage}`);
  }

  logSunoCreditUsage(taskId, statusResponse);

  const result = await downloadSunoAudio({
    storageDir,
    track,
    trackVersion,
    kind,
    statusResponse,
  });
  return {
    ...result,
    raw: {
      ...result.raw,
      task_id: taskId,
    },
  };
}

module.exports = {
  buildSunoPayload,
  generateMusicWithSuno,
  submitSunoTask,
  pollSunoTaskOnce,
  downloadSunoAudio,
  logSunoCreditUsage,
  sanitizeLyricsForSunoPolicy,
  isSunoPolicyError,
};
