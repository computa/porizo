const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { fetchJson, ensureDir } = require("./http");
const { pollWithBackoff, createPollingConfig } = require("../utils/polling");
const { normalizeStyle, getStyle } = require("./style-registry");
const { trackProviderAudioKey } = require("../storage");
const config = require("../config");
const execFileAsync = promisify(execFile);

// U1: Resolves the Suno callback URL.
// Order: explicit config.SUNO_CALLBACK_URL → derived from PUBLIC_BASE_URL.
// Never falls back to a public service (httpbin or otherwise).
// See src/routes/internal-suno-callback.js for the receiving endpoint.
function resolveSunoCallbackUrl() {
  const appendToken = (url) => {
    const secret = String(config.SUNO_CALLBACK_HMAC_SECRET || "");
    if (!secret) {
      return url;
    }
    if (secret.length < 32) {
      throw new Error(
        "E302_SUNO_CALLBACK_NOT_CONFIGURED: SUNO_CALLBACK_HMAC_SECRET must be at least 32 characters",
      );
    }
    const parsed = new URL(url);
    if (!parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", secret);
    }
    return parsed.toString();
  };
  if (
    typeof config.SUNO_CALLBACK_URL === "string" &&
    config.SUNO_CALLBACK_URL.trim()
  ) {
    return appendToken(config.SUNO_CALLBACK_URL.trim());
  }
  const base = (config.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "E302_SUNO_CALLBACK_NOT_CONFIGURED: SUNO_CALLBACK_URL or PUBLIC_BASE_URL must be set",
    );
  }
  return appendToken(`${base}/internal/suno/callback`);
}

const MERGED_TENS_WORD_REGEX =
  /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]?(one|two|three|four|five|six|seven|eight|nine)\b/gi;
const POLICY_ERROR_PATTERNS = [
  "producer tag",
  "specific artists",
  "sensitive_word_error",
];
const SUNO_AUDIO_SUCCESS_STATUSES = new Set([
  "AUDIO_SUCCESS",
  "SUCCESS",
  "COMPLETE",
  "COMPLETED",
  "MEDIA_SUCCESS",
  "RENDER_SUCCESS",
]);
const SUNO_PROVISIONAL_SUCCESS_STATUSES = new Set([
  "TEXT_SUCCESS",
  "LYRICS_SUCCESS",
]);
const SUNO_FAILED_STATUSES = new Set(["FAILED", "ERROR"]);
const SUNO_MODELS = Object.freeze(["V4_5", "V5", "V5_5"]);

function normalizeSunoModel(model) {
  if (typeof model !== "string") {
    return "V5";
  }
  const normalized = model
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]+/g, "_");
  if (normalized === "V45") return "V4_5";
  if (normalized === "V55") return "V5_5";
  return SUNO_MODELS.includes(normalized) ? normalized : "V5";
}

function normalizeSunoStatus(status) {
  if (typeof status !== "string") {
    return "";
  }
  return status.trim().toUpperCase();
}

function normalizeSunoPersona(persona) {
  if (!persona || typeof persona !== "object") {
    return null;
  }
  const rawPersonaId =
    persona.personaId ||
    persona.persona_id ||
    persona.providerPersonaId ||
    persona.provider_persona_id ||
    persona.provider_profile_id;
  if (typeof rawPersonaId !== "string" || !rawPersonaId.trim()) {
    return null;
  }
  const rawPersonaModel =
    persona.personaModel || persona.persona_model || "voice_persona";
  const personaModel =
    typeof rawPersonaModel === "string" && rawPersonaModel.trim()
      ? rawPersonaModel.trim()
      : "voice_persona";
  return {
    personaId: rawPersonaId.trim(),
    personaModel,
    audioWeight: normalizeSunoAudioWeight(
      persona.audioWeight ?? persona.audio_weight,
    ),
  };
}

function normalizeSunoAudioWeight(value, fallback = null) {
  if (value == null && fallback == null) {
    return null;
  }
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) {
    return fallback == null ? null : normalizeSunoAudioWeight(fallback, null);
  }
  const clamped = Math.max(0, Math.min(1, numeric));
  return Math.round(clamped * 100) / 100;
}

function classifySunoStatus(status) {
  const normalized = normalizeSunoStatus(status);
  if (!normalized) {
    return { phase: "pending", status: normalized };
  }
  if (
    SUNO_FAILED_STATUSES.has(normalized) ||
    normalized.endsWith("_ERROR") ||
    normalized.endsWith("_FAILED")
  ) {
    return { phase: "failed", status: normalized };
  }
  if (SUNO_AUDIO_SUCCESS_STATUSES.has(normalized)) {
    return { phase: "audio_success", status: normalized };
  }
  if (
    SUNO_PROVISIONAL_SUCCESS_STATUSES.has(normalized) ||
    normalized.endsWith("SUCCESS")
  ) {
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

function summarizeForLog(value, maxLen = 120) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 1)}…`;
}

function isSunoPolicyError(rawMessage) {
  if (!rawMessage) return false;
  const message = String(rawMessage).toLowerCase();
  return POLICY_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Build a rich style descriptor for Suno's `style` field from registry data.
 * Suno v4.5 expects concise genre descriptors (4-7 terms), not verbose specs.
 * Truncates to maxLen to respect API limits (1000 chars for V4_5).
 */
/**
 * Resolve negative constraints for Suno's dedicated `negative_tags` API parameter.
 * Extracted separately so they don't consume style field characters.
 */
function resolveSunoNegativeTags(styleDef, musicPlan) {
  const constraints = Array.isArray(musicPlan?.style_negative_constraints)
    ? musicPlan.style_negative_constraints
    : Array.isArray(styleDef.suno?.negative_constraints)
      ? styleDef.suno.negative_constraints
      : [];
  if (constraints.length === 0) return null;
  return constraints.slice(0, 8).join(", ");
}

/**
 * Resolve Suno consistency parameters (styleWeight, weirdnessConstraint)
 * based on the genre's support level. Weaker genres get tighter control.
 */
function resolveSunoConsistencyParams(styleDef) {
  const support = styleDef.suno?.support || "unknown";
  switch (support) {
    case "strong":
      return { styleWeight: 0.65, weirdnessConstraint: 0.5 };
    case "medium":
      return { styleWeight: 0.8, weirdnessConstraint: 0.3 };
    case "weak":
      return { styleWeight: 0.9, weirdnessConstraint: 0.15 };
    default:
      return { styleWeight: 0.75, weirdnessConstraint: 0.35 };
  }
}

function buildSunoStyleField(
  styleDef,
  normalized,
  musicPlan,
  voiceGender,
  maxLen = 500,
) {
  const providerHint =
    musicPlan?.provider_style_hint ||
    styleDef.suno?.hint ||
    styleDef.suno?.instruction_override ||
    null;
  const basePrompt =
    musicPlan?.style_prompt_compact ||
    styleDef.prompt ||
    `${normalized.replace(/_/g, " ")} arrangement`;

  // Use instruction_override as primary when available (more specific for Suno),
  // fall back to generic prompt. Avoids redundant text consuming char budget.
  const compactPrompt = providerHint || basePrompt;

  // Build comma-separated style tags (Suno V4.5 best practice: front-load important tags)
  const parts = [compactPrompt];

  // Inject BPM from music plan into style field (stabilizes rhythm)
  if (musicPlan?.bpm && !compactPrompt.includes("BPM")) {
    parts.push(`${musicPlan.bpm} BPM`);
  }

  // For weak/medium-support genres, inject rhythmic_signature to anchor the groove
  const support = styleDef.suno?.support || "unknown";
  if (
    (support === "weak" || support === "medium") &&
    styleDef.rhythmic_signature
  ) {
    parts.push(styleDef.rhythmic_signature);
  }

  // Vocal character descriptor (genre-appropriate vocal guidance)
  if (voiceGender && styleDef.vocal_character) {
    const vocalDesc = styleDef.vocal_character[voiceGender];
    if (vocalDesc) {
      parts.push(vocalDesc);
    }
  }

  parts.push("[no producer tag]");
  return parts.join(", ").replace(/\s+/g, " ").trim().slice(0, maxLen);
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
 * @param {object|null} [options.sunoPersona] - Optional Suno persona routing.
 * @returns {object} Suno API payload
 */
function buildSunoPayload({
  lyrics,
  musicPlan,
  track,
  instrumental,
  sunoModel,
  sunoPersona,
}) {
  const styleKey = (musicPlan && musicPlan.style) || "pop";
  // Single style resolution — all helpers receive pre-resolved styleDef
  const normalized = normalizeStyle(styleKey) || "pop";
  const styleDef = getStyle(normalized);
  const voiceGender = musicPlan?.voice_gender || track?.voice_gender || null;

  const style = buildSunoStyleField(
    styleDef,
    normalized,
    musicPlan,
    voiceGender,
  );

  // Build prompt from lyrics with vocal metatag at the top
  let prompt = "";

  // Inject vocal gender metatag — placed at top of lyrics for whole-song effect
  const vocalTag =
    voiceGender === "male"
      ? "[Male Vocal]\n"
      : voiceGender === "female"
        ? "[Female Vocal]\n"
        : "";

  if (lyrics && lyrics.sections && lyrics.sections.length > 0) {
    const formattedSections = lyrics.sections.map((section) => {
      const sectionHeader = section.name ? `[${section.name}]` : "";
      const lines = section.lines
        ? section.lines
            .map((l) => (typeof l === "string" ? l : (l && l.text) || ""))
            .join("\n")
        : "";
      return sectionHeader ? `${sectionHeader}\n${lines}` : lines;
    });
    prompt = vocalTag + formattedSections.join("\n\n");
  } else if (track) {
    const parts = [];
    if (track.recipient_name) parts.push(`for ${track.recipient_name}`);
    if (track.occasion) parts.push(track.occasion);
    if (track.message) parts.push(track.message);
    prompt = vocalTag + (parts.join(" - ") || "Generate a song");
  }

  const titleSource =
    (lyrics && lyrics.title) || (track && track.title) || "Untitled";
  const title = titleSource.replace(
    MERGED_TENS_WORD_REGEX,
    (_, tens, ones) => `${tens} ${ones}`,
  );

  const negativeTags = resolveSunoNegativeTags(styleDef, musicPlan);
  const consistencyParams = resolveSunoConsistencyParams(styleDef);
  const persona = normalizeSunoPersona(sunoPersona);

  const payload = {
    model: normalizeSunoModel(sunoModel),
    prompt,
    title,
    style,
    instrumental: instrumental === true,
    negativeTags,
    ...consistencyParams,
  };
  if (persona) {
    payload.personaId = persona.personaId;
    payload.personaModel = persona.personaModel;
    if (persona.audioWeight != null) {
      payload.audioWeight = persona.audioWeight;
    }
  }
  return payload;
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
    throw new Error(
      "E302_SUNO_ERROR: Valid track with user_id and id required",
    );
  }
  if (trackVersion && !trackVersion.version_num) {
    throw new Error(
      "E302_SUNO_ERROR: Valid trackVersion with version_num required",
    );
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
  sunoModel,
  sunoPersona,
  fetchJsonFn = fetchJson,
}) {
  validateSunoInput({ apiKey, baseUrl, track });
  const internalPayload = buildSunoPayload({
    lyrics,
    musicPlan,
    track,
    sunoModel,
    sunoPersona,
  });
  const apiPayload = {
    customMode: true,
    instrumental: internalPayload.instrumental,
    model: internalPayload.model,
    prompt: internalPayload.prompt,
    style: internalPayload.style,
    title: internalPayload.title,
    // U1: Callback URL resolved from config (no httpbin fallback). We poll for
    // status; the callback endpoint is a stub that returns 200 (HMAC-verified).
    callBackUrl: resolveSunoCallbackUrl(),
  };
  if (internalPayload.personaId) {
    apiPayload.personaId = internalPayload.personaId;
    apiPayload.personaModel = internalPayload.personaModel || "voice_persona";
    if (internalPayload.audioWeight != null) {
      apiPayload.audioWeight = internalPayload.audioWeight;
    }
  }
  // Suno V4.5 consistency controls — sent as separate params, not inside style text
  if (internalPayload.negativeTags) {
    apiPayload.negativeTags = internalPayload.negativeTags;
  }
  if (internalPayload.styleWeight != null) {
    apiPayload.styleWeight = internalPayload.styleWeight;
  }
  if (internalPayload.weirdnessConstraint != null) {
    apiPayload.weirdnessConstraint = internalPayload.weirdnessConstraint;
  }

  const submitUrl = `${baseUrl}/api/v1/generate`;
  console.log(
    `[Suno] Submitting to ${submitUrl} model=${apiPayload.model} style=${musicPlan?.style || "unknown"} title="${summarizeForLog(apiPayload.title, 80)}" instrumental=${apiPayload.instrumental} persona=${apiPayload.personaId ? apiPayload.personaModel || "voice_persona" : "none"} promptChars=${apiPayload.prompt.length} styleChars=${apiPayload.style.length}`,
  );
  const submitResponse = await fetchJsonFn(
    submitUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(apiPayload),
    },
    timeoutMs,
  );
  if (submitResponse.code !== 200) {
    throw new Error(`E302_SUNO_ERROR: API error - ${submitResponse.msg}`);
  }
  const taskId = submitResponse.data?.taskId || submitResponse.data?.task_id;
  if (!taskId) {
    throw new Error("E302_SUNO_ERROR: No task ID returned from API");
  }
  console.log(`[Suno] Task submitted: ${taskId} model=${apiPayload.model}`);
  if (typeof onTaskId === "function") {
    try {
      onTaskId(taskId);
    } catch (err) {
      console.warn(
        `[Suno] Failed to persist task id ${taskId}:`,
        err.message || err,
      );
    }
  }
  return taskId;
}

async function pollSunoTaskOnce({
  baseUrl,
  apiKey,
  taskId,
  timeoutMs,
  onHeartbeat,
}) {
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
    timeoutMs,
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
    const detail =
      readiness.reason === "no_audio_data"
        ? "No audio data in response"
        : "No audio URL in response";
    throw new Error(
      `E302_SUNO_INCOMPLETE_OUTPUT: status=${statusLabel}, ${detail}`,
    );
  }

  return {
    sunoData: readiness.tracks,
    firstTrack: readiness.track,
    audioUrl: readiness.audioUrl,
  };
}

async function downloadSunoAudio({
  storageDir,
  track,
  trackVersion,
  kind,
  statusResponse,
  storageProvider = null,
}) {
  const { sunoData, firstTrack, audioUrl } = extractSunoTrack(
    statusResponse,
    statusResponse?.data?.status || null,
  );
  console.log(`[Suno] Downloading audio from: ${audioUrl}`);

  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`,
  );
  ensureDir(versionDir);

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(
      `E302_SUNO_ERROR: Failed to download audio - ${audioResponse.status}`,
    );
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
      `E302_SUNO_AUDIO_NOT_READY: status=${statusLabel}, reason=${validation.reason}, duration=${durationLabel}s, codec=${codecLabel}`,
    );
  }

  let mirror;
  try {
    mirror = await mirrorSunoAudioToStorage({
      storageProvider,
      track,
      trackVersion,
      kind,
      filePath: outputPath,
    });
  } catch (err) {
    // The provider step is not complete until the durable mirror exists. Remove
    // the local cache so a retry cannot skip mirroring by reusing this file.
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    } catch (cleanupErr) {
      console.warn(
        `[Suno] Failed to remove unmirrored provider audio ${instName}: ${cleanupErr.message}`,
      );
    }
    throw err;
  }

  console.log(`[Suno] Saved ${audioBuffer.length} bytes to ${instName}`);
  console.log(
    `[Suno] Duration: ${validation.durationSec ?? firstTrack.duration}s, Codec: ${validation.codecName}, Model: ${firstTrack.modelName}`,
  );

  return {
    instrumental_file: instName,
    vocal_file: null, // Suno generates combined audio (music + vocals)
    raw: {
      audio_url: audioUrl,
      guide_vocal_url: audioUrl,
      instrumental_url: audioUrl,
      duration: Number.isFinite(validation.durationSec)
        ? validation.durationSec
        : firstTrack.duration,
      model: firstTrack.modelName,
      alt_audio_url: sunoData[1]?.sourceAudioUrl || sunoData[1]?.audioUrl,
      status: statusLabel,
      provider_audio_key: mirror.key,
      provider_audio_mirrored: mirror.mirrored,
    },
  };
}

async function mirrorSunoAudioToStorage({
  storageProvider,
  track,
  trackVersion,
  kind,
  filePath,
}) {
  if (!storageProvider || typeof storageProvider.putFile !== "function") {
    return { key: null, mirrored: false };
  }
  const key = trackProviderAudioKey({
    userId: track.user_id,
    trackId: track.id,
    versionNum: trackVersion.version_num,
    provider: "suno",
    kind,
    format: "mp3",
  });
  try {
    await storageProvider.putFile({
      key,
      filePath,
      contentType: "audio/mpeg",
    });
  } catch (err) {
    throw new Error(
      `E302_SUNO_MIRROR_FAILED: Failed to mirror Suno audio to storage - ${err?.message || err}`,
    );
  }
  console.log(`[Suno] Mirrored ${kind} provider audio to storage: ${key}`);
  return { key, mirrored: true };
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
    const codecName =
      audioStreams
        .map((stream) =>
          typeof stream?.codec_name === "string"
            ? stream.codec_name.trim()
            : "",
        )
        .find(Boolean) || null;
    const formatDuration = Number(parsed?.format?.duration);
    let durationSec =
      Number.isFinite(formatDuration) && formatDuration > 0
        ? formatDuration
        : null;
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
    return {
      ready: false,
      reason: "duration_unknown",
      durationSec: null,
      codecName: metadata.codecName,
    };
  }

  const minDurationSec = kind === "preview" ? 8 : 24;
  if (durationSec < minDurationSec) {
    return {
      ready: false,
      reason: "duration_too_short",
      durationSec,
      codecName: metadata.codecName,
    };
  }

  return {
    ready: true,
    reason: null,
    durationSec,
    codecName: metadata.codecName,
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
  sunoModel,
  sunoPersona,
  storageProvider = null,
}) {
  validateSunoInput({ apiKey, baseUrl, track, trackVersion });
  console.log(
    `[Suno] Generating music for track ${track.id}, version=${trackVersion?.version_num || "unknown"}, kind=${kind}, model=${normalizeSunoModel(sunoModel)}`,
  );

  const taskId = await submitSunoTask({
    baseUrl,
    apiKey,
    lyrics,
    musicPlan,
    track,
    timeoutMs,
    onTaskId,
    sunoModel,
    sunoPersona,
  });

  // Use exponential backoff polling
  const pollingConfig = createPollingConfig("suno");
  let statusResponse;
  let sawSuccessWithoutAudio = false;
  let lastSuccessWithoutAudioReason = null;
  let lastSuccessStatus = null;

  // Derive max attempts from timeoutMs if provided
  // Average interval approximation: (initial + max) / 2 = (5000 + 30000) / 2 = 17500ms
  const avgIntervalMs =
    (pollingConfig.initialIntervalMs + pollingConfig.maxIntervalMs) / 2;
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

        if (
          statusInfo.phase === "audio_success" ||
          statusInfo.phase === "provisional_success"
        ) {
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
          const errorMsg =
            result.response?.data?.errorMessage || "Unknown error";
          return {
            done: false,
            failed: true,
            error: `E302_SUNO_ERROR: Generation failed - ${errorMsg}`,
          };
        }
        return { done: false, response: result.response, status };
      },
      {
        ...pollingConfig,
        maxAttempts: derivedMaxAttempts,
        onPoll: (attempt, interval) => {
          console.log(
            `[Suno] Polling task ${taskId}, attempt ${attempt}/${derivedMaxAttempts}, next interval: ${interval}ms`,
          );
        },
      },
    );
    statusResponse = pollResult.response;
  } catch (pollErr) {
    // Re-throw if already a Suno error (preserves original context)
    if (pollErr?.message?.includes("E302_SUNO_")) {
      throw pollErr;
    }
    const errMessage = pollErr?.message ?? String(pollErr || "unknown error");
    const isTimeout =
      errMessage.includes("exceeded") || errMessage.includes("Polling timeout");
    if (isTimeout && sawSuccessWithoutAudio) {
      const detail =
        lastSuccessWithoutAudioReason === "no_audio_data"
          ? "No audio data in response"
          : "No audio URL in response";
      throw new Error(
        `E302_SUNO_INCOMPLETE_OUTPUT: status=${lastSuccessStatus || "unknown"}, ${detail}`,
      );
    }
    throw new Error(
      `E302_SUNO_ERROR: task=${taskId}, ${isTimeout ? "Generation timed out" : errMessage}`,
    );
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
      storageProvider,
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
  SUNO_MODELS,
  normalizeSunoModel,
  normalizeSunoPersona,
  normalizeSunoAudioWeight,
  buildSunoPayload,
  generateMusicWithSuno,
  resolveSunoCallbackUrl,
  submitSunoTask,
  pollSunoTaskOnce,
  downloadSunoAudio,
  logSunoCreditUsage,
  isSunoPolicyError,
  classifySunoStatus,
  inspectSunoAudioReadiness,
};
