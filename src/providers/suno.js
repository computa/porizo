const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { fetchJson, ensureDir } = require("./http");
const { pollWithBackoff, createPollingConfig } = require("../utils/polling");
const { normalizeStyle, getStyle } = require("./style-registry");
const execFileAsync = promisify(execFile);

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
const SUNO_AUDIO_SUCCESS_STATUSES = new Set([
  "AUDIO_SUCCESS",
  "SUCCESS",
  "COMPLETE",
  "COMPLETED",
  "MEDIA_SUCCESS",
  "RENDER_SUCCESS",
]);
const SUNO_PROVISIONAL_SUCCESS_STATUSES = new Set(["TEXT_SUCCESS", "LYRICS_SUCCESS"]);
const SUNO_FAILED_STATUSES = new Set(["FAILED", "ERROR"]);

function normalizeSunoStatus(status) {
  if (typeof status !== "string") {
    return "";
  }
  return status.trim().toUpperCase();
}

function classifySunoStatus(status) {
  const normalized = normalizeSunoStatus(status);
  if (!normalized) {
    return { phase: "pending", status: normalized };
  }
  if (SUNO_FAILED_STATUSES.has(normalized) || normalized.endsWith("_ERROR")) {
    return { phase: "failed", status: normalized };
  }
  if (SUNO_AUDIO_SUCCESS_STATUSES.has(normalized)) {
    return { phase: "audio_success", status: normalized };
  }
  if (SUNO_PROVISIONAL_SUCCESS_STATUSES.has(normalized) || normalized.endsWith("SUCCESS")) {
    return { phase: "provisional_success", status: normalized };
  }
  return { phase: "pending", status: normalized };
}

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
  parts.push("[no producer tag]");
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

function toTrackArray(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.filter((item) => item && typeof item === "object");
}

function collectSunoTracks(statusResponse) {
  const response = statusResponse?.data?.response || {};
  const data = statusResponse?.data || {};

  const candidates = [
    response.sunoData,
    response.suno_data,
    response.data,
    data.sunoData,
    data.suno_data,
    data.data,
  ];

  const tracks = [];
  for (const candidate of candidates) {
    tracks.push(...toTrackArray(candidate));
  }
  return tracks;
}

function resolveSunoAudioUrl(track) {
  if (!track || typeof track !== "object") {
    return null;
  }

  const directCandidates = [
    track.sourceAudioUrl,
    track.source_audio_url,
    track.audioUrl,
    track.audio_url,
    track.audioURL,
    track.streamAudioUrl,
    track.stream_audio_url,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedCandidates = [
    track.audio?.url,
    track.audio?.audioUrl,
    track.audio?.audio_url,
    track.sourceAudio?.url,
    track.source_audio?.url,
  ];
  for (const candidate of nestedCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function inspectSunoAudioReadiness(statusResponse) {
  const tracks = collectSunoTracks(statusResponse);
  if (tracks.length === 0) {
    return { ready: false, reason: "no_audio_data", tracks };
  }

  for (const track of tracks) {
    const audioUrl = resolveSunoAudioUrl(track);
    if (audioUrl) {
      return {
        ready: true,
        reason: null,
        tracks,
        track,
        audioUrl,
      };
    }
  }

  return {
    ready: false,
    reason: "no_audio_url",
    tracks,
  };
}

function extractSunoTrack(statusResponse, status = null) {
  const readiness = inspectSunoAudioReadiness(statusResponse);
  if (!readiness.ready) {
    const statusLabel = status || statusResponse?.data?.status || "unknown";
    const detail = readiness.reason === "no_audio_data"
      ? "No audio data in response"
      : "No audio URL in response";
    throw new Error(`E302_SUNO_INCOMPLETE_OUTPUT: status=${statusLabel}, ${detail}`);
  }

  return {
    sunoData: readiness.tracks,
    firstTrack: readiness.track,
    audioUrl: readiness.audioUrl,
  };
}

async function downloadSunoAudio({ storageDir, track, trackVersion, kind, statusResponse }) {
  const { sunoData, firstTrack, audioUrl } = extractSunoTrack(
    statusResponse,
    statusResponse?.data?.status || null
  );
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
  const outputPath = path.join(versionDir, instName);
  fs.writeFileSync(outputPath, audioBuffer);

  const statusLabel = statusResponse?.data?.status || "unknown";
  const validation = await validateDownloadedSunoAudio({
    filePath: outputPath,
    kind,
  });
  if (!validation.ready) {
    const durationLabel = Number.isFinite(validation.durationSec)
      ? validation.durationSec.toFixed(2)
      : "unknown";
    const codecLabel = validation.codecName || "unknown";
    throw new Error(
      `E302_SUNO_AUDIO_NOT_READY: status=${statusLabel}, reason=${validation.reason}, duration=${durationLabel}s, codec=${codecLabel}`
    );
  }

  console.log(`[Suno] Saved ${audioBuffer.length} bytes to ${instName}`);
  console.log(
    `[Suno] Duration: ${validation.durationSec ?? firstTrack.duration}s, Codec: ${validation.codecName}, Model: ${firstTrack.modelName}`
  );

  return {
    instrumental_file: instName,
    vocal_file: null, // Suno generates combined audio (music + vocals)
    raw: {
      audio_url: audioUrl,
      guide_vocal_url: audioUrl,
      instrumental_url: audioUrl,
      duration: Number.isFinite(validation.durationSec) ? validation.durationSec : firstTrack.duration,
      model: firstTrack.modelName,
      alt_audio_url: sunoData[1]?.sourceAudioUrl || sunoData[1]?.audioUrl,
      status: statusLabel,
    },
  };
}

function getFFprobePath() {
  try {
    return require("@ffprobe-installer/ffprobe").path;
  } catch (_err) {
    return "ffprobe";
  }
}

async function probeAudioMetadata(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(getFFprobePath(), [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const parsed = JSON.parse(stdout || "{}");
    const audioStreams = Array.isArray(parsed?.streams)
      ? parsed.streams.filter((stream) => stream?.codec_type === "audio")
      : [];
    const codecName = audioStreams
      .map((stream) => (typeof stream?.codec_name === "string" ? stream.codec_name.trim() : ""))
      .find(Boolean) || null;
    const formatDuration = Number(parsed?.format?.duration);
    let durationSec = Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : null;
    if (!durationSec) {
      const streamDurations = audioStreams
        .map((stream) => Number(stream?.duration))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (streamDurations.length > 0) {
        durationSec = Math.max(...streamDurations);
      }
    }
    return {
      durationSec,
      hasAudioStream: audioStreams.length > 0,
      codecName,
    };
  } catch (_err) {
    return null;
  }
}

async function validateDownloadedSunoAudio({ filePath, kind }) {
  const metadata = await probeAudioMetadata(filePath);
  if (!metadata || !metadata.hasAudioStream) {
    return {
      ready: false,
      reason: "no_audio_stream",
      durationSec: metadata?.durationSec ?? null,
      codecName: metadata?.codecName || null,
    };
  }
  if (!metadata.codecName) {
    return {
      ready: false,
      reason: "codec_unknown",
      durationSec: metadata.durationSec,
      codecName: null,
    };
  }
  const durationSec = metadata.durationSec;
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ready: false, reason: "duration_unknown", durationSec: null, codecName: metadata.codecName };
  }

  const minDurationSec = kind === "preview" ? 8 : 24;
  if (durationSec < minDurationSec) {
    return { ready: false, reason: "duration_too_short", durationSec, codecName: metadata.codecName };
  }

  return { ready: true, reason: null, durationSec, codecName: metadata.codecName };
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
  let sawSuccessWithoutAudio = false;
  let lastSuccessWithoutAudioReason = null;
  let lastSuccessStatus = null;

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
        const statusInfo = classifySunoStatus(status);

        if (statusInfo.phase === "audio_success" || statusInfo.phase === "provisional_success") {
          const readiness = inspectSunoAudioReadiness(result.response);
          if (readiness.ready) {
            return { done: true, response: result.response, status };
          }
          sawSuccessWithoutAudio = true;
          lastSuccessWithoutAudioReason = readiness.reason;
          lastSuccessStatus = status;
          return { done: false, response: result.response, status };
        }
        if (statusInfo.phase === "failed") {
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
    if (pollErr?.message?.includes("E302_SUNO_")) {
      throw pollErr;
    }
    const errMessage = pollErr?.message ?? String(pollErr || "unknown error");
    const isTimeout = errMessage.includes("exceeded") || errMessage.includes("Polling timeout");
    if (isTimeout && sawSuccessWithoutAudio) {
      const detail = lastSuccessWithoutAudioReason === "no_audio_data"
        ? "No audio data in response"
        : "No audio URL in response";
      throw new Error(
        `E302_SUNO_INCOMPLETE_OUTPUT: status=${lastSuccessStatus || "unknown"}, ${detail}`
      );
    }
    throw new Error(`E302_SUNO_ERROR: task=${taskId}, ${isTimeout ? "Generation timed out" : errMessage}`);
  }

  logSunoCreditUsage(taskId, statusResponse);

  let result;
  try {
    result = await downloadSunoAudio({
      storageDir,
      track,
      trackVersion,
      kind,
      statusResponse,
    });
  } catch (downloadErr) {
    const message = String(downloadErr?.message || "");
    if (message.startsWith("E302_SUNO_AUDIO_NOT_READY:")) {
      const detail = message.replace("E302_SUNO_AUDIO_NOT_READY:", "").trim();
      throw new Error(`E302_SUNO_INCOMPLETE_OUTPUT: ${detail}`);
    }
    throw downloadErr;
  }
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
  classifySunoStatus,
  inspectSunoAudioReadiness,
};
