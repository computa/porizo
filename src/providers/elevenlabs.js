const fs = require("fs");
const path = require("path");
const { fetchJson, fetchBinaryWithHeaders, ensureDir } = require("./http");

const DEFAULT_MUSIC_MODEL_ID = "music_v1";
const DEFAULT_COMPOSITION_PLAN_ENDPOINT = "/v1/music/plan";
const DEFAULT_MUSIC_COMPOSE_ENDPOINT = "/v1/music";

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

function parseProviderErrorDetails(error) {
  const message = String(error?.message || "");
  const match = message.match(/^provider_error:(\d+):(.*)$/s);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  const rawBody = match[2] || "";
  let body = null;

  try {
    body = JSON.parse(rawBody);
  } catch (_err) {
    body = null;
  }

  return {
    statusCode,
    rawBody,
    body,
  };
}

function extractPromptSuggestion(errorBody) {
  const detail = errorBody?.detail || null;
  if (!detail || typeof detail !== "object") {
    return null;
  }
  if (detail.status !== "bad_prompt") {
    return null;
  }
  const suggestion = detail?.data?.prompt_suggestion;
  return typeof suggestion === "string" && suggestion.trim().length > 0
    ? suggestion.trim()
    : null;
}

function extractCompositionPlanSuggestion(errorBody) {
  const detail = errorBody?.detail || null;
  if (!detail || typeof detail !== "object") {
    return null;
  }
  if (detail.status !== "bad_composition_plan") {
    return null;
  }

  const suggestion = detail?.data?.composition_plan_suggestion;
  if (!suggestion) {
    return null;
  }

  if (typeof suggestion === "object") {
    return suggestion;
  }

  if (typeof suggestion === "string") {
    try {
      return JSON.parse(suggestion);
    } catch (_err) {
      return null;
    }
  }

  return null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveCompositionPlan(responseBody) {
  if (!responseBody || typeof responseBody !== "object") {
    return null;
  }

  if (responseBody.composition_plan && typeof responseBody.composition_plan === "object") {
    return responseBody.composition_plan;
  }

  if (Array.isArray(responseBody.sections)) {
    return responseBody;
  }

  return null;
}

function sanitizeCompositionPlanForInstrumental(plan) {
  if (!plan || typeof plan !== "object") {
    return plan;
  }

  const sanitized = cloneJson(plan);
  if (!Array.isArray(sanitized.sections)) {
    return sanitized;
  }

  sanitized.sections = sanitized.sections.map((section) => ({
    ...section,
    lines: [],
  }));
  return sanitized;
}

function buildNarrativeMotif(lyrics) {
  if (!lyrics || typeof lyrics !== "object") {
    return null;
  }

  const pieces = [];
  if (typeof lyrics.title === "string" && lyrics.title.trim()) {
    pieces.push(`Title: ${lyrics.title.trim()}`);
  }
  if (typeof lyrics.anchor_line === "string" && lyrics.anchor_line.trim()) {
    pieces.push(`Anchor phrase: ${lyrics.anchor_line.trim()}`);
  }
  if (typeof lyrics.anchorLine === "string" && lyrics.anchorLine.trim()) {
    pieces.push(`Anchor phrase: ${lyrics.anchorLine.trim()}`);
  }

  if (pieces.length === 0) {
    return null;
  }

  return pieces.join(" | ");
}

function resolveGenerationMode(musicPlan) {
  if (!musicPlan || typeof musicPlan !== "object") {
    return "composition_plan";
  }
  return musicPlan.generation_mode === "compose_detailed"
    ? "compose_detailed"
    : "composition_plan";
}

function summarizeCompositionPlan(plan) {
  if (!plan || typeof plan !== "object") {
    return null;
  }
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const sectionSummary = sections.slice(0, 16).map((section) => ({
    name: section?.name || "section",
    lines: Array.isArray(section?.lines) ? section.lines.length : 0,
  }));
  return {
    section_count: sections.length,
    sections: sectionSummary,
  };
}

function formatValidationError(error, operation) {
  const details = parseProviderErrorDetails(error);
  if (!details) {
    return error;
  }
  if (details.statusCode === 422) {
    const status = details.body?.detail?.status;
    if (status === "bad_prompt") {
      return new Error(
        `E301_ELEVENLABS_VALIDATION: ${operation} rejected prompt. Use stricter style constraints and retry.`
      );
    }
    if (status === "bad_composition_plan") {
      return new Error(
        `E301_ELEVENLABS_VALIDATION: ${operation} rejected composition plan. Use provider suggestion or simplify section content.`
      );
    }
    return new Error(`E301_ELEVENLABS_VALIDATION: ${operation} validation failed.`);
  }
  return error;
}

/**
 * Build payload for ElevenLabs composition plan API.
 * Production flow is strictly composition-plan driven:
 * /v1/music/plan -> /v1/music (with composition_plan)
 */
function buildCompositionPlanRequest({ lyrics, musicPlan, kind }) {
  const modelId = (musicPlan && musicPlan.model_id) || DEFAULT_MUSIC_MODEL_ID;
  const styleIntent = musicPlan?.style_intent || null;
  const generationMode = resolveGenerationMode(musicPlan);
  const styleGuide =
    (musicPlan && musicPlan.style_prompt) ||
    (styleIntent && styleIntent.genre_core) ||
    ((musicPlan && musicPlan.style)
      ? `${String(musicPlan.style).replace(/_/g, " ")} style`
      : "modern pop style");
  const durationSec = (musicPlan && musicPlan.duration_sec) || 60;
  const bpm = musicPlan && musicPlan.bpm ? Number(musicPlan.bpm) : null;
  const key = musicPlan && musicPlan.key ? String(musicPlan.key) : null;
  const energy = musicPlan && musicPlan.energy ? String(musicPlan.energy) : null;
  const motif = buildNarrativeMotif(lyrics);

  const promptParts = [
    "Compose a high-fidelity studio-quality instrumental music track.",
    `Primary style direction: ${styleGuide}.`,
    "Do not include sung vocals, spoken words, chants, vocal chops, or ad-libs.",
    `Target duration: ${durationSec} seconds.`,
    generationMode === "compose_detailed"
      ? "Use detailed arrangement control with explicit adherence to style instrumentation and groove identity."
      : "Use composition-plan optimization to preserve coherent arrangement and style identity.",
    kind === "preview"
      ? "Arrangement objective: concise and hook-forward for preview listening."
      : "Arrangement objective: full-song development with coherent progression and dynamics.",
  ];

  if (bpm && Number.isFinite(bpm)) {
    promptParts.push(`Tempo target: ${bpm} BPM.`);
  }
  if (key) {
    promptParts.push(`Key center target: ${key}.`);
  }
  if (energy) {
    promptParts.push(`Energy profile: ${energy}.`);
  }
  if (styleIntent && styleIntent.rhythmic_signature) {
    promptParts.push(`Rhythmic signature: ${styleIntent.rhythmic_signature}.`);
  }
  if (styleIntent && styleIntent.arrangement_notes) {
    promptParts.push(`Arrangement notes: ${styleIntent.arrangement_notes}.`);
  }
  if (Array.isArray(styleIntent?.instrument_palette) && styleIntent.instrument_palette.length > 0) {
    promptParts.push(`Instrument palette: ${styleIntent.instrument_palette.join(", ")}.`);
  }
  if (styleIntent && styleIntent.instruction_override) {
    promptParts.push(styleIntent.instruction_override);
  }
  if (Array.isArray(styleIntent?.negative_constraints) && styleIntent.negative_constraints.length > 0) {
    promptParts.push(`Avoid: ${styleIntent.negative_constraints.join(", ")}.`);
  }
  if (motif) {
    promptParts.push(`Narrative motif for melodic mood: ${motif}.`);
  }

  const prompt = promptParts.join(" ");
  return {
    prompt,
    music_length_ms: durationSec * 1000,
    model_id: modelId,
    generation_mode: generationMode,
  };
}

async function createCompositionPlan({
  baseUrl,
  apiKey,
  compositionPlanEndpoint,
  requestBody,
  timeoutMs,
  trackId,
}) {
  const endpointCandidates = [
    compositionPlanEndpoint,
    "/v1/music/plan",
    "/v1/music/create-composition-plan",
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const dedupedEndpoints = [...new Set(endpointCandidates)];
  let body = requestBody;

  let lastError = null;
  for (const endpoint of dedupedEndpoints) {
    const url = `${baseUrl}${endpoint}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchJson(
          url,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "xi-api-key": apiKey,
            },
            body: JSON.stringify(body),
          },
          timeoutMs
        );
        const plan = resolveCompositionPlan(response);
        if (!plan || !Array.isArray(plan.sections) || plan.sections.length === 0) {
          throw new Error("E301_ELEVENLABS_ERROR: Invalid composition plan response");
        }
        return { plan, endpoint };
      } catch (error) {
        if (error?.message === "request_timeout") {
          throw new Error("provider_error:timeout:ElevenLabs composition plan request timed out");
        }
        const details = parseProviderErrorDetails(error);
        const suggestion =
          details && details.statusCode === 422
            ? extractPromptSuggestion(details.body)
            : null;

        if (suggestion && attempt === 0) {
          console.warn(
            `[ElevenLabs] bad_prompt for track ${trackId}; retrying composition plan with provider suggestion`
          );
          body = {
            ...body,
            prompt: suggestion,
          };
          continue;
        }
        if (details && details.statusCode === 404) {
          lastError = error;
          break;
        }
        throw formatValidationError(error, "composition_plan");
      }
    }
    // Reset retries when trying the next endpoint.
    body = requestBody;
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("E301_ELEVENLABS_ERROR: Unable to create composition plan");
}

async function composeFromPlan({
  baseUrl,
  composeEndpoint,
  apiKey,
  timeoutMs,
  modelId,
  musicLengthMs,
  compositionPlan,
  trackId,
  respectSectionsDurations = false,
}) {
  const url = `${baseUrl}${composeEndpoint}`;
  let payload = {
    composition_plan: compositionPlan,
    model_id: modelId,
    music_length_ms: musicLengthMs,
    respect_sections_durations: Boolean(respectSectionsDurations),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchBinaryWithHeaders(
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
    } catch (error) {
      if (error?.message === "request_timeout") {
        throw new Error("provider_error:timeout:ElevenLabs compose request timed out");
      }
      const details = parseProviderErrorDetails(error);
      const suggestion =
        details && details.statusCode === 422
          ? extractCompositionPlanSuggestion(details.body)
          : null;

      if (suggestion && attempt === 0) {
        console.warn(
          `[ElevenLabs] bad_composition_plan for track ${trackId}; retrying compose with provider suggestion`
        );
        payload = {
          ...payload,
          composition_plan: sanitizeCompositionPlanForInstrumental(suggestion),
        };
        continue;
      }
      throw formatValidationError(error, "compose");
    }
  }

  throw new Error("E301_ELEVENLABS_ERROR: Unable to compose from composition plan");
}

async function composeDetailed(params) {
  return composeFromPlan({
    ...params,
    respectSectionsDurations: true,
  });
}

async function generateMusic({
  baseUrl,
  endpoint,
  compositionPlanEndpoint,
  apiKey,
  storageDir,
  track,
  trackVersion,
  lyrics,
  musicPlan,
  timeoutMs,
  kind,
}) {
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

  const composeEndpoint = endpoint || DEFAULT_MUSIC_COMPOSE_ENDPOINT;
  const planEndpoint = compositionPlanEndpoint || DEFAULT_COMPOSITION_PLAN_ENDPOINT;
  const requestBody = buildCompositionPlanRequest({ lyrics, musicPlan, kind });
  const generationMode = resolveGenerationMode(musicPlan);
  const modelId = requestBody.model_id || DEFAULT_MUSIC_MODEL_ID;

  console.log(
    `[ElevenLabs] Creating composition plan for track ${track.id}, kind: ${kind}, mode=${generationMode}`
  );
  const { plan, endpoint: resolvedPlanEndpoint } = await createCompositionPlan({
    baseUrl,
    apiKey,
    compositionPlanEndpoint: planEndpoint,
    requestBody,
    timeoutMs,
    trackId: track.id,
  });

  const instrumentalPlan = sanitizeCompositionPlanForInstrumental(plan);
  const composeOperation = generationMode === "compose_detailed" ? composeDetailed : composeFromPlan;

  console.log(`[ElevenLabs] Composing from plan for track ${track.id}, kind: ${kind}, mode=${generationMode}`);
  const { buffer: audioBuffer, headers } = await composeOperation({
    baseUrl,
    composeEndpoint,
    apiKey,
    timeoutMs,
    modelId,
    musicLengthMs: requestBody.music_length_ms,
    compositionPlan: instrumentalPlan,
    trackId: track.id,
  });

  logCreditUsage("music_generation", headers);

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("E301_ELEVENLABS_ERROR: Empty audio response from API");
  }
  if (audioBuffer.length < 1000) {
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
      provider: "elevenlabs",
      instrumental_url: null,
      guide_vocal_url: null,
      generation_mode: generationMode,
      style_intent: musicPlan?.style_intent || null,
      composition_plan_summary: summarizeCompositionPlan(instrumentalPlan),
      request_prompt: requestBody.prompt,
      request_music_length_ms: requestBody.music_length_ms,
      model_id: modelId,
      response_bytes: audioBuffer.length,
      respect_sections_durations: generationMode === "compose_detailed",
      compose_endpoint: composeEndpoint,
      plan_endpoint: resolvedPlanEndpoint || planEndpoint,
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
  buildCompositionPlanRequest,
  createCompositionPlan,
  composeDetailed,
  sanitizeCompositionPlanForInstrumental,
  generateMusic,
  generateSpeech,
  lyricsToText,
  logCreditUsage,
};
