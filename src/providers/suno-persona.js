const { fetchJson } = require("./http");
const { sanitizeProviderError } = require("../utils/provider-sanitize");
const {
  classifySunoStatus,
  inspectSunoAudioReadiness,
  normalizeSunoModel,
  pollSunoTaskOnce,
} = require("./suno");
const { createPollingConfig, pollWithBackoff } = require("../utils/polling");

const DEFAULT_UPLOAD_BASE_URL = "https://sunoapiorg.redpandaai.co";
const DEFAULT_PREP_PROMPT = [
  "[Verse]",
  "Sing this clear melody in a natural voice",
  "Keep the vocal centered and expressive",
].join("\n");
const DEFAULT_PREP_STYLE = "clean pop vocal, warm studio mix, clear lead vocal";
const DEFAULT_PREP_TITLE = "Porizo Voice Persona Seed";

function normalizeBaseUrl(baseUrl, fallback = null) {
  const raw =
    typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : fallback;
  if (!raw) {
    return "";
  }
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`E302_SUNO_PERSONA_ERROR: ${name} is required`);
  }
  return value.trim();
}

function ensureSuccess(response, context) {
  const ok =
    response?.code === 200 ||
    response?.success === true ||
    String(response?.msg || "").toLowerCase() === "success";
  if (!ok) {
    throw new Error(
      `E302_SUNO_PERSONA_ERROR: ${context} failed - ${sanitizeProviderError(response?.msg || "unknown_error")}`,
    );
  }
  return response.data || {};
}

function normalizeAudioWeight(value, fallback = 0.85) {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  const clamped = Math.max(0, Math.min(1, base));
  return Math.round(clamped * 100) / 100;
}

function redactedId(value) {
  if (typeof value !== "string" || value.length <= 8) {
    return value ? "[redacted]" : null;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function describeShape(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "object") {
    return `object{${Object.keys(value).slice(0, 8).join(",")}}`;
  }
  return typeof value;
}

function pickAudioIdLike(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = candidate.audioId || candidate.audio_id || candidate.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

/**
 * U6: Typed extractor for SunoAPI upload-cover task status response.
 *
 * Walks an explicit, fixture-backed set of field paths. The previous
 * `collectObjects` graph traversal was a cycle-safe DFS that succeeded on
 * almost any JSON shape — including error responses with stray ID-shaped
 * fields — and produced opaque "use whatever audio-shaped string we found
 * first" behavior.
 *
 * On unrecognized shapes, throws E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN with a
 * redacted description of what we got. Re-run `tools/suno-persona-probe.js`
 * after seeing this error to update the fixture and add the new path here.
 *
 * Fixture: test/fixtures/suno-upload-cover-response.json
 */
function extractSunoAudioId(statusResponse) {
  // Path 1: pre-extracted by inspectSunoAudioReadiness (the canonical Suno
  // helper for "is this audio ready"). When it surfaces a track object, that
  // is authoritative.
  const readiness = inspectSunoAudioReadiness(statusResponse);
  const fromReadiness = pickAudioIdLike(readiness?.track);
  if (fromReadiness) return fromReadiness;

  // Path 2: direct field paths matching the captured fixture shape
  // (test/fixtures/suno-upload-cover-response.json). These are the ONLY paths
  // we recognize — if SunoAPI ever returns a new shape, the throw below will
  // fire loud enough to update both the fixture and this list.
  const sunoData =
    statusResponse?.data?.response?.sunoData ||
    statusResponse?.data?.response?.suno_data ||
    null;
  if (Array.isArray(sunoData) && sunoData.length > 0) {
    const id = pickAudioIdLike(sunoData[0]);
    if (id) return id;
  }

  const dataResponse = statusResponse?.data?.response;
  const directOnResponse = pickAudioIdLike(dataResponse);
  if (directOnResponse) return directOnResponse;

  const directOnData = pickAudioIdLike(statusResponse?.data);
  if (directOnData) return directOnData;

  // Unrecognized shape: fail loud. Logging the shape (not values) lets ops
  // re-run the probe and update the fixture without leaking IDs.
  throw new Error(
    `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN: upload-cover response shape did not match any known path. shape=${describeShape(
      statusResponse?.data,
    )}.${describeShape(statusResponse?.data?.response)}`,
  );
}

async function uploadFileUrl({
  uploadBaseUrl = DEFAULT_UPLOAD_BASE_URL,
  apiKey,
  fileUrl,
  uploadPath = "porizo/voice-personas",
  fileName = null,
  timeoutMs = 30000,
  fetchJsonFn = fetchJson,
} = {}) {
  const endpoint = `${normalizeBaseUrl(uploadBaseUrl, DEFAULT_UPLOAD_BASE_URL)}/api/file-url-upload`;
  const body = {
    fileUrl: requireString(fileUrl, "fileUrl"),
    uploadPath: requireString(uploadPath, "uploadPath"),
  };
  if (fileName) {
    body.fileName = requireString(fileName, "fileName");
  }
  const response = await fetchJsonFn(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${requireString(apiKey, "apiKey")}`,
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const data = ensureSuccess(response, "file upload");
  const downloadUrl = data.downloadUrl || data.download_url;
  if (typeof downloadUrl !== "string" || !downloadUrl.trim()) {
    throw new Error(
      "E302_SUNO_PERSONA_ERROR: file upload returned no downloadUrl",
    );
  }
  return {
    downloadUrl: downloadUrl.trim(),
    fileName: data.fileName || data.file_name || null,
    filePath: data.filePath || data.file_path || null,
    fileSize: data.fileSize || data.file_size || null,
    mimeType: data.mimeType || data.mime_type || null,
    raw: data,
  };
}

function buildUploadCoverPayload({
  uploadUrl,
  model = "V5_5",
  prompt = DEFAULT_PREP_PROMPT,
  style = DEFAULT_PREP_STYLE,
  title = DEFAULT_PREP_TITLE,
  audioWeight = 0.85,
  callBackUrl,
} = {}) {
  // U1: callBackUrl is now REQUIRED — no httpbin.org fallback.
  // Caller (suno-voice-persona-service) reads from config.SUNO_CALLBACK_URL
  // and throws E302_SUNO_PERSONA_CALLBACK_NOT_CONFIGURED when feature on AND unset.
  return {
    uploadUrl: requireString(uploadUrl, "uploadUrl"),
    customMode: true,
    instrumental: false,
    model: normalizeSunoModel(model),
    prompt: requireString(prompt, "prompt"),
    style: requireString(style, "style"),
    title: requireString(title, "title").slice(0, 100),
    audioWeight: normalizeAudioWeight(audioWeight),
    callBackUrl: requireString(callBackUrl, "callBackUrl"),
  };
}

async function submitUploadCoverTask({
  baseUrl,
  apiKey,
  timeoutMs = 30000,
  fetchJsonFn = fetchJson,
  ...payloadOptions
} = {}) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/api/v1/generate/upload-cover`;
  const payload = buildUploadCoverPayload(payloadOptions);
  const response = await fetchJsonFn(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${requireString(apiKey, "apiKey")}`,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  const data = ensureSuccess(response, "upload-cover");
  const taskId = data.taskId || data.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("E302_SUNO_PERSONA_ERROR: upload-cover returned no taskId");
  }
  console.log(
    `[SunoPersona] upload-cover submitted task=${redactedId(taskId)} model=${payload.model}`,
  );
  return {
    taskId: taskId.trim(),
    model: payload.model,
    raw: data,
  };
}

async function pollUploadCoverForAudio({
  baseUrl,
  apiKey,
  taskId,
  timeoutMs = 30000,
  pollTaskOnceFn = pollSunoTaskOnce,
  pollingOptions = null,
  onHeartbeat = null,
  captureRawResponse = null,
} = {}) {
  const task = requireString(taskId, "taskId");
  const pollingConfig = pollingOptions || createPollingConfig("suno");
  const result = await pollWithBackoff(
    async () => {
      const poll = await pollTaskOnceFn({
        baseUrl,
        apiKey,
        taskId: task,
        timeoutMs,
        onHeartbeat,
      });
      if (typeof captureRawResponse === "function") {
        captureRawResponse(poll.response);
      }
      const statusInfo = classifySunoStatus(poll.status);
      if (
        statusInfo.phase === "audio_success" ||
        statusInfo.phase === "provisional_success"
      ) {
        // U6 polling fix: provisional_success can arrive before sunoData is
        // populated. extractSunoAudioId throws E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN
        // when no recognized field path resolves — which happens legitimately
        // mid-poll (provisional state with empty data.response). Treat that as
        // "not done yet" so the poll loop continues. A genuine shape mismatch
        // will surface only when the final audio_success state still can't be
        // extracted, at which point the throw surfaces to the caller.
        let audioId = null;
        try {
          audioId = extractSunoAudioId(poll.response);
        } catch (err) {
          if (
            statusInfo.phase === "provisional_success" &&
            String(err?.message || "").includes(
              "E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN",
            )
          ) {
            return {
              done: false,
              status: poll.status,
              response: poll.response,
            };
          }
          throw err;
        }
        const readiness = inspectSunoAudioReadiness(poll.response);
        if (audioId && readiness.ready) {
          return {
            done: true,
            status: poll.status,
            audioId,
            response: poll.response,
          };
        }
        return { done: false, status: poll.status, response: poll.response };
      }
      if (statusInfo.phase === "failed") {
        const errorMsg =
          poll.response?.data?.errorMessage ||
          poll.response?.msg ||
          "unknown_error";
        return {
          done: false,
          failed: true,
          error: `E302_SUNO_PERSONA_ERROR: upload-cover failed - ${sanitizeProviderError(errorMsg)}`,
        };
      }
      return { done: false, status: poll.status, response: poll.response };
    },
    {
      ...pollingConfig,
      onPoll: (attempt, interval) => {
        console.log(
          `[SunoPersona] polling upload-cover task=${redactedId(task)} attempt=${attempt} next=${interval}ms`,
        );
      },
    },
  );
  if (!result?.done || !result.audioId) {
    throw new Error(
      "E302_SUNO_PERSONA_AUDIO_NOT_READY: upload-cover polling finished without a ready audioId",
    );
  }
  return {
    audioId: result.audioId,
    status: result.status,
    response: result.response,
  };
}

function buildGeneratePersonaPayload({
  taskId,
  audioId,
  name,
  description,
  vocalStart = 0,
  vocalEnd = 30,
  style = DEFAULT_PREP_STYLE,
} = {}) {
  const start = Math.max(0, Number(vocalStart) || 0);
  const requestedEnd = Number(vocalEnd);
  const end = Number.isFinite(requestedEnd) ? requestedEnd : start + 30;
  const duration = end - start;
  if (duration < 10 || duration > 30) {
    throw new Error(
      "E302_SUNO_PERSONA_ERROR: vocal range must be between 10 and 30 seconds",
    );
  }
  return {
    taskId: requireString(taskId, "taskId"),
    audioId: requireString(audioId, "audioId"),
    name: requireString(name, "name").slice(0, 100),
    description: requireString(description, "description").slice(0, 500),
    vocalStart: start,
    vocalEnd: end,
    style: requireString(style, "style").slice(0, 1000),
  };
}

async function generatePersona({
  baseUrl,
  apiKey,
  timeoutMs = 30000,
  fetchJsonFn = fetchJson,
  ...payloadOptions
} = {}) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/api/v1/generate/generate-persona`;
  const payload = buildGeneratePersonaPayload(payloadOptions);
  const response = await fetchJsonFn(
    endpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${requireString(apiKey, "apiKey")}`,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  const data = ensureSuccess(response, "generate-persona");
  const personaId = data.personaId || data.persona_id;
  if (typeof personaId !== "string" || !personaId.trim()) {
    throw new Error(
      "E302_SUNO_PERSONA_ERROR: generate-persona returned no personaId",
    );
  }
  console.log(`[SunoPersona] persona created id=${redactedId(personaId)}`);
  return {
    personaId: personaId.trim(),
    name: data.name || payload.name,
    description: data.description || payload.description,
    raw: data,
  };
}

module.exports = {
  DEFAULT_UPLOAD_BASE_URL,
  buildGeneratePersonaPayload,
  buildUploadCoverPayload,
  extractSunoAudioId,
  generatePersona,
  normalizeAudioWeight,
  pollUploadCoverForAudio,
  redactedId,
  submitUploadCoverTask,
  uploadFileUrl,
};
