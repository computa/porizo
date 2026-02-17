const { sanitizeLyricsForProviderPolicy } = require("../services/lyrics-policy-sanitizer");

const PERSONALIZED_VOICE_MODES = new Set(["user_voice", "personalized"]);

function normalizeVoiceMode(rawVoiceMode) {
  return PERSONALIZED_VOICE_MODES.has(rawVoiceMode) ? "user_voice" : "ai_voice";
}

function buildRenderContract({ provider, voiceMode, voiceConversionProvider }) {
  const providerLocked = provider === "elevenlabs" ? "elevenlabs" : "suno";
  const normalizedVoiceMode = normalizeVoiceMode(voiceMode);
  let pipeline = "guide_tts_and_voice_convert";

  if (providerLocked === "suno" && normalizedVoiceMode === "ai_voice") {
    pipeline = "provider_complete_audio";
  } else if (providerLocked === "suno" && normalizedVoiceMode === "user_voice") {
    pipeline = "provider_audio_personalized_convert";
  }

  return {
    provider_locked: providerLocked,
    voice_mode: normalizedVoiceMode,
    pipeline,
    fallback_allowed_until_step: "instrumental",
    voice_conversion_provider: voiceConversionProvider || null,
  };
}

function resolveRenderContract({ track, musicPlan, strict = false }) {
  const existingContract =
    musicPlan?.render_contract && typeof musicPlan.render_contract === "object"
      ? musicPlan.render_contract
      : null;

  if (strict && !existingContract) {
    throw new Error(
      "E302_CONTRACT_MISSING: Personalized render requires frozen contract in music_plan_json."
    );
  }

  if (existingContract) {
    return {
      provider_locked: existingContract.provider_locked || musicPlan?.provider_resolved || "suno",
      voice_mode: normalizeVoiceMode(existingContract.voice_mode || track?.voice_mode),
      pipeline: existingContract.pipeline || "guide_tts_and_voice_convert",
      fallback_allowed_until_step: existingContract.fallback_allowed_until_step || "instrumental",
      voice_conversion_provider: existingContract.voice_conversion_provider || null,
    };
  }
  return buildRenderContract({
    provider: musicPlan?.provider_resolved || "suno",
    voiceMode: track?.voice_mode,
  });
}

const PERSONALIZED_PIPELINES = new Set([
  "provider_audio_personalized_convert",
  "guide_tts_and_voice_convert",
]);

function assertFrozenContract(musicPlan) {
  if (!(musicPlan?.render_contract && typeof musicPlan.render_contract === "object")) {
    throw new Error(
      "E302_CONTRACT_MISSING: Personalized render requires frozen contract in music_plan_json."
    );
  }
}

function assertPersonalizedContract(renderContract, stepName) {
  if (renderContract.voice_mode !== "user_voice") {
    throw new Error(
      `E302_PERSONALIZED_DIVERSION: Step '${stepName}' expected voice_mode='user_voice' ` +
      `but contract has '${renderContract.voice_mode}'.`
    );
  }
  if (!PERSONALIZED_PIPELINES.has(renderContract.pipeline)) {
    throw new Error(
      `E302_PERSONALIZED_DIVERSION: Step '${stepName}' has pipeline='${renderContract.pipeline}' ` +
      `which is invalid for personalized voice.`
    );
  }
  if (!renderContract.provider_locked) {
    throw new Error(
      `E302_PERSONALIZED_DIVERSION: Step '${stepName}' has no provider_locked.`
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
  if (typeof instrumentalUrl === "string" && /^https?:\/\//i.test(instrumentalUrl.trim())) {
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
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) {
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
  { sanitizeLyricsForProviderPolicyFn = sanitizeLyricsForProviderPolicy } = {}
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
      suggestions: Array.isArray(result.suggestions) ? result.suggestions.slice(0, 6) : [],
    });
    blocked = blocked || Boolean(result.blocked);
  }

  return {
    lyrics: current,
    changed: totalChanges > 0,
    change_count: totalChanges,
    blocked,
    reports,
    suggestions: reports.flatMap((report) => report.suggestions || []).slice(0, 8),
  };
}

module.exports = {
  normalizeVoiceMode,
  buildRenderContract,
  resolveRenderContract,
  assertFrozenContract,
  assertPersonalizedContract,
  getProviderAudioUrl,
  extractProviderAudioUrl,
  sanitizeProviderRoutingForContract,
  sanitizeLyricsForAllMusicProviders,
  shouldSkipStep,
};
