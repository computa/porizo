const {
  sanitizeLyricsForProviderPolicy,
} = require("../services/lyrics-policy-sanitizer");

const PERSONALIZED_VOICE_MODES = new Set(["user_voice", "personalized"]);
const SUNO_VOICE_PERSONA_PIPELINE = "suno_voice_persona_complete_audio";
const USER_VOICE_ENGINES = new Set(["suno_voice_persona"]);

function normalizeVoiceMode(rawVoiceMode) {
  return PERSONALIZED_VOICE_MODES.has(rawVoiceMode) ? "user_voice" : "ai_voice";
}

function normalizeUserVoiceEngine(rawEngine, voiceConversionProvider = null) {
  const candidate =
    typeof rawEngine === "string" && rawEngine.trim()
      ? rawEngine.trim()
      : voiceConversionProvider;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = candidate.trim().toLowerCase();
  return USER_VOICE_ENGINES.has(normalized) ? normalized : null;
}

function isSunoVoicePersonaPipeline(pipeline) {
  return pipeline === SUNO_VOICE_PERSONA_PIPELINE;
}

function isProviderCompleteAudioPipeline(pipeline) {
  return (
    pipeline === "provider_complete_audio" ||
    isSunoVoicePersonaPipeline(pipeline)
  );
}

function buildRenderContract({
  provider,
  voiceMode,
  voiceConversionProvider,
  userVoiceEngine,
  voiceProviderProfileId,
}) {
  const providerLocked = provider === "elevenlabs" ? "elevenlabs" : "suno";
  const normalizedVoiceMode = normalizeVoiceMode(voiceMode);
  const normalizedUserVoiceEngine =
    normalizedVoiceMode === "user_voice"
      ? normalizeUserVoiceEngine(userVoiceEngine, voiceConversionProvider)
      : null;
  let pipeline = "guide_tts_and_voice_convert";

  if (providerLocked === "suno" && normalizedVoiceMode === "ai_voice") {
    pipeline = "provider_complete_audio";
  } else if (
    providerLocked === "suno" &&
    normalizedVoiceMode === "user_voice" &&
    normalizedUserVoiceEngine === "suno_voice_persona"
  ) {
    pipeline = SUNO_VOICE_PERSONA_PIPELINE;
  } else if (normalizedVoiceMode === "user_voice") {
    throw new Error(
      "E302_SUNO_PERSONA_REQUIRED: My Voice renders require an active Suno voice persona. Seed-VC voice conversion fallback is disabled.",
    );
  }

  return {
    provider_locked: providerLocked,
    voice_mode: normalizedVoiceMode,
    pipeline,
    fallback_allowed_until_step: "instrumental",
    voice_conversion_provider: voiceConversionProvider || null,
    user_voice_engine: normalizedUserVoiceEngine,
    voice_provider_profile_id: voiceProviderProfileId || null,
  };
}

function resolveRenderContract({ track, musicPlan, strict = false }) {
  const existingContract =
    musicPlan?.render_contract && typeof musicPlan.render_contract === "object"
      ? musicPlan.render_contract
      : null;

  if (strict && !existingContract) {
    throw new Error(
      "E302_CONTRACT_MISSING: Personalized render requires frozen contract in music_plan_json.",
    );
  }

  if (existingContract) {
    return {
      provider_locked:
        existingContract.provider_locked ||
        musicPlan?.provider_resolved ||
        "suno",
      voice_mode: normalizeVoiceMode(
        existingContract.voice_mode || track?.voice_mode,
      ),
      pipeline: existingContract.pipeline || "guide_tts_and_voice_convert",
      fallback_allowed_until_step:
        existingContract.fallback_allowed_until_step || "instrumental",
      voice_conversion_provider:
        existingContract.voice_conversion_provider || null,
      user_voice_engine: normalizeUserVoiceEngine(
        existingContract.user_voice_engine,
        existingContract.voice_conversion_provider || null,
      ),
      voice_provider_profile_id:
        existingContract.voice_provider_profile_id || null,
    };
  }
  // U4: fallback path. If this would resolve to the Suno-persona pipeline,
  // it MUST be supplied with a voice_provider_profile_id. The pre-U4 behavior
  // was to silently emit voice_provider_profile_id=null and let the runner
  // discover the misconfiguration mid-render — after billing, with the user
  // already on the loading screen.
  const fallback = buildRenderContract({
    provider: musicPlan?.provider_resolved || "suno",
    voiceMode: track?.voice_mode,
  });
  if (
    fallback.pipeline === SUNO_VOICE_PERSONA_PIPELINE &&
    !fallback.voice_provider_profile_id
  ) {
    throw new Error(
      "E302_SUNO_PERSONA_PROFILE_MISSING: render contract fallback resolved to Suno persona pipeline without a voice_provider_profile_id. Caller must provide the active provider profile.",
    );
  }
  return fallback;
}

const PERSONALIZED_PIPELINES = new Set([SUNO_VOICE_PERSONA_PIPELINE]);

function assertFrozenContract(musicPlan) {
  if (
    !(
      musicPlan?.render_contract &&
      typeof musicPlan.render_contract === "object"
    )
  ) {
    throw new Error(
      "E302_CONTRACT_MISSING: Personalized render requires frozen contract in music_plan_json.",
    );
  }
}

function assertPersonalizedContract(renderContract, stepName) {
  if (renderContract.voice_mode !== "user_voice") {
    throw new Error(
      `E302_PERSONALIZED_DIVERSION: Step '${stepName}' expected voice_mode='user_voice' ` +
        `but contract has '${renderContract.voice_mode}'.`,
    );
  }
  if (!PERSONALIZED_PIPELINES.has(renderContract.pipeline)) {
    throw new Error(
      `E302_PERSONALIZED_DIVERSION: Step '${stepName}' has pipeline='${renderContract.pipeline}' ` +
        `which is invalid for personalized voice.`,
    );
  }
  if (!renderContract.provider_locked) {
    throw new Error(
      `E302_PERSONALIZED_DIVERSION: Step '${stepName}' has no provider_locked.`,
    );
  }
}

function safeParseJson(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function getProviderAudioUrl(trackVersion) {
  const provenance = safeParseJson(trackVersion?.provenance_json, {});
  const provenanceUrl = provenance?.music?.provider_audio_url;
  if (typeof provenanceUrl === "string" && provenanceUrl.trim()) {
    return provenanceUrl.trim();
  }
  const instrumentalUrl = trackVersion?.instrumental_url;
  if (
    typeof instrumentalUrl === "string" &&
    /^https?:\/\//i.test(instrumentalUrl.trim())
  ) {
    return instrumentalUrl.trim();
  }
  return null;
}

function extractProviderAudioUrl(providerResultRaw) {
  const candidates = [
    providerResultRaw?.provider_audio_url,
    providerResultRaw?.audio_url,
    providerResultRaw?.guide_vocal_url,
    providerResultRaw?.instrumental_url,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      /^https?:\/\//i.test(candidate.trim())
    ) {
      return candidate.trim();
    }
  }
  return null;
}

function sanitizeProviderRoutingForContract(routingMetadata, renderContract) {
  if (!routingMetadata || typeof routingMetadata !== "object") {
    return null;
  }
  if (!renderContract?.provider_locked) {
    return routingMetadata;
  }
  return {
    ...routingMetadata,
    provider: renderContract.provider_locked,
    reason:
      routingMetadata.reason === "pinned_provider"
        ? routingMetadata.reason
        : `${routingMetadata.reason || "runtime"}_locked`,
    switched: routingMetadata.provider !== renderContract.provider_locked,
  };
}

function summarizePolicyTerms(violations, max = 6) {
  if (!Array.isArray(violations) || violations.length === 0) {
    return [];
  }
  const terms = [];
  const seen = new Set();
  for (const violation of violations) {
    const raw = String(violation?.term || "")
      .trim()
      .toLowerCase();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
    if (terms.length >= max) break;
  }
  return terms;
}

/**
 * Declarative map: which steps to skip for each pipeline.
 * Single source of truth — avoids duplicating conditionals across step handlers.
 */
const PIPELINE_SKIP_MAP = {
  provider_complete_audio: new Set([
    "guide_vocal",
    "guide_vocal_full",
    "voice_convert",
    "voice_convert_sections",
  ]),
  [SUNO_VOICE_PERSONA_PIPELINE]: new Set([
    "guide_vocal",
    "guide_vocal_full",
    "voice_convert",
    "voice_convert_sections",
  ]),
  provider_audio_personalized_convert: new Set([
    "guide_vocal",
    "guide_vocal_full",
  ]),
  guide_tts_and_voice_convert: new Set([]),
};

function shouldSkipStep(stepName, pipeline) {
  return PIPELINE_SKIP_MAP[pipeline]?.has(stepName) ?? false;
}

function sanitizeLyricsForAllMusicProviders(
  lyrics,
  {
    recipientName = null,
    sanitizeLyricsForProviderPolicyFn = sanitizeLyricsForProviderPolicy,
  } = {},
) {
  const providers = ["suno", "elevenlabs"];
  let current = lyrics;
  let totalChanges = 0;
  let blocked = false;
  const reports = [];

  for (const provider of providers) {
    const result = sanitizeLyricsForProviderPolicyFn({
      lyrics: current,
      provider,
      recipientName,
    });
    if (result.changed) {
      current = result.lyrics;
      totalChanges += result.change_count || 0;
    }
    reports.push({
      provider,
      blocked: Boolean(result.blocked),
      change_count: result.change_count || 0,
      rewrite_passes: result.rewrite_passes || 0,
      violation_terms: summarizePolicyTerms(result.violations || [], 8),
      suggestions: Array.isArray(result.suggestions)
        ? result.suggestions.slice(0, 6)
        : [],
    });
    blocked = blocked || Boolean(result.blocked);
  }

  return {
    lyrics: current,
    changed: totalChanges > 0,
    change_count: totalChanges,
    blocked,
    reports,
    suggestions: reports
      .flatMap((report) => report.suggestions || [])
      .slice(0, 8),
  };
}

module.exports = {
  SUNO_VOICE_PERSONA_PIPELINE,
  PERSONALIZED_VOICE_MODES,
  normalizeVoiceMode,
  normalizeUserVoiceEngine,
  buildRenderContract,
  resolveRenderContract,
  assertFrozenContract,
  assertPersonalizedContract,
  isSunoVoicePersonaPipeline,
  isProviderCompleteAudioPipeline,
  getProviderAudioUrl,
  extractProviderAudioUrl,
  sanitizeProviderRoutingForContract,
  sanitizeLyricsForAllMusicProviders,
  shouldSkipStep,
};
