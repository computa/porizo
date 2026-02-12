const crypto = require("crypto");
const path = require("path");
const { generateMusic } = require("./elevenlabs");
const { generateMusicWithSuno } = require("./suno");
const {
  STYLES,
  STYLE_ALIASES,
  normalizeStyle,
  getStyle,
  getProviderStyleCapability,
  normalizeStringArray,
} = require("./style-registry");
const { writeWav } = require("../utils/audio");

function deterministicRangeInt({ min, max, seed }) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Math.max(0, Math.floor(min || 0));
  }
  if (!seed || typeof seed !== "string") {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  const value = parseInt(digest.slice(0, 8), 16);
  const span = max - min + 1;
  return min + (value % span);
}

function deterministicPick(items, seed) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  if (!seed || typeof seed !== "string") {
    return items[Math.floor(Math.random() * items.length)];
  }
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  const value = parseInt(digest.slice(0, 8), 16);
  return items[value % items.length];
}

function buildStyleIntent({
  style,
  requestedStyle,
  provider = null,
  bpm,
  key,
  energy,
  styleOverrides = null,
}) {
  const normalizedStyle = normalizeStyle(style) || "pop";
  const styleDef = getStyle(normalizedStyle);
  const capability = getProviderStyleCapability({
    style: normalizedStyle,
    provider: provider || "elevenlabs",
    styleOverrides,
  });
  const basePrompt = styleDef.prompt || `${normalizedStyle.replace(/_/g, " ")} arrangement`;

  const instrumentPalette = normalizeStringArray([
    ...(styleDef.instrument_palette || []),
    ...(capability.instrument_palette || []),
  ], { maxItems: 10 });

  const negativeConstraints = normalizeStringArray(capability.negative_constraints || [], { maxItems: 12 });

  return {
    style: normalizedStyle,
    requested_style: requestedStyle || null,
    provider: provider || null,
    support: capability.support,
    support_score: capability.support_score,
    genre_core:
      capability.genre_core ||
      styleDef.genre_core ||
      `${normalizedStyle.replace(/_/g, " ")} groove`,
    rhythmic_signature:
      capability.rhythmic_signature ||
      styleDef.rhythmic_signature ||
      "Steady modern rhythm with clear groove pocket",
    arrangement_notes:
      capability.arrangement_notes ||
      styleDef.arrangement_notes ||
      "Keep arrangement cohesive with clear dynamic arc and memorable hook motifs",
    instrument_palette: instrumentPalette,
    instruction_override: capability.instruction_override || null,
    negative_constraints: negativeConstraints,
    bpm,
    key,
    energy,
    base_prompt: basePrompt,
    degraded: capability.support_score < 3,
  };
}

function renderStyleIntentPrompt(styleIntent) {
  if (!styleIntent || typeof styleIntent !== "object") {
    return "modern pop arrangement";
  }

  const parts = [
    styleIntent.base_prompt || `${(styleIntent.style || "pop").replace(/_/g, " ")} arrangement`,
    `Genre core: ${styleIntent.genre_core}.`,
    `Rhythm: ${styleIntent.rhythmic_signature}.`,
    `Arrangement: ${styleIntent.arrangement_notes}.`,
    `Tempo target ${styleIntent.bpm} BPM, key center ${styleIntent.key}, energy ${styleIntent.energy}.`,
  ];

  if (styleIntent.instrument_palette?.length > 0) {
    parts.push(`Instrument palette: ${styleIntent.instrument_palette.join(", ")}.`);
  }
  if (styleIntent.instruction_override) {
    parts.push(styleIntent.instruction_override);
  }
  if (styleIntent.negative_constraints?.length > 0) {
    parts.push(`Avoid: ${styleIntent.negative_constraints.join(", ")}.`);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function getStylePrompt(style, provider = null, styleOverrides = null) {
  const normalized = normalizeStyle(style) || "pop";
  const profile = getStyle(normalized);
  const bpm = deterministicRangeInt({
    min: profile.bpmRange[0],
    max: profile.bpmRange[1],
    seed: `${normalized}:style_prompt:bpm`,
  });
  const key = deterministicPick(profile.keys, `${normalized}:style_prompt:key`) || profile.keys[0] || "C";
  const styleIntent = buildStyleIntent({
    style: normalized,
    requestedStyle: style,
    provider,
    bpm,
    key,
    energy: profile.energy,
    styleOverrides,
  });
  return renderStyleIntentPrompt(styleIntent);
}

/**
 * Get style profile with fallback to default
 * @param {string} style - Music style key
 * @returns {Object} Style profile (bpmRange, keys, energy)
 */
function getStyleProfile(style) {
  return getStyle(style);
}

/**
 * Generate random BPM within style's range
 * @param {Object} profile - Style profile
 * @returns {number} BPM value
 */
function selectBpm(profile, seed = null) {
  const [min, max] = profile.bpmRange;
  return deterministicRangeInt({ min, max, seed });
}

/**
 * Select key appropriate for style
 * @param {Object} profile - Style profile
 * @returns {string} Musical key
 */
function selectKey(profile, seed = null) {
  const keys = profile.keys;
  return deterministicPick(keys, seed) || keys[0];
}

/**
 * Calculate section structure based on duration target
 * @param {number} durationSec - Target duration in seconds
 * @param {number} bpm - Beats per minute
 * @returns {Array} Section structure
 */
function calculateSections(durationSec, bpm) {
  // Each bar = 4 beats, each beat = 60/bpm seconds
  const barDurationSec = (4 * 60) / bpm;

  // Calculate total bars available
  const totalBars = Math.floor(durationSec / barDurationSec);

  // Section structure based on duration
  if (durationSec <= 30) {
    // Preview: chorus only
    return [{ name: "chorus", bars: Math.min(totalBars, 8) }];
  } else if (durationSec <= 60) {
    // Short song: verse + chorus + verse + chorus
    const chorusBars = Math.min(8, Math.floor(totalBars * 0.3));
    const verseBars = Math.min(8, Math.floor(totalBars * 0.2));
    return [
      { name: "verse1", bars: verseBars },
      { name: "chorus", bars: chorusBars },
      { name: "verse2", bars: verseBars },
      { name: "chorus2", bars: chorusBars },
    ];
  } else {
    // Full song: verse + chorus + verse + chorus + bridge + chorus
    const chorusBars = 8;
    const verseBars = 8;
    const bridgeBars = 4;
    return [
      { name: "verse1", bars: verseBars },
      { name: "chorus", bars: chorusBars },
      { name: "verse2", bars: verseBars },
      { name: "chorus2", bars: chorusBars },
      { name: "bridge", bars: bridgeBars },
      { name: "chorus3", bars: chorusBars },
    ];
  }
}

/**
 * Build a style-aware music plan
 * @param {Object} params - Plan parameters
 * @param {string} params.style - Music style
 * @param {number} params.durationTarget - Target duration in seconds
 * @returns {Object} Music plan
 */
function buildMusicPlan({ style, durationTarget, provider, seed = null, styleOverrides = null, generationMode = "composition_plan" }) {
  const duration = durationTarget || 60;
  const normalizedStyle = normalizeStyle(style) || "pop";
  const profile = getStyle(normalizedStyle);
  const planSeed = seed || `${normalizedStyle}:${duration}:${provider || "none"}`;
  const bpm = selectBpm(profile, `${planSeed}:bpm`);
  const key = selectKey(profile, `${planSeed}:key`);
  const sections = calculateSections(duration, bpm);
  const styleIntent = buildStyleIntent({
    style: normalizedStyle,
    requestedStyle: style,
    provider,
    bpm,
    key,
    energy: profile.energy,
    styleOverrides,
  });

  return {
    bpm,
    key,
    duration_sec: duration,
    style: normalizedStyle,
    requested_style: style || null,
    style_prompt: renderStyleIntentPrompt(styleIntent),
    style_intent: styleIntent,
    generation_mode: generationMode === "compose_detailed" ? "compose_detailed" : "composition_plan",
    energy: profile.energy,
    deterministic_seed: planSeed,
    sections,
  };
}

function renderInstrumental({ storageDir, track, trackVersion, kind }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "inst_preview.wav" : "inst_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 6 : 12,
    frequencyHz: 220,
  });
  return { file: fileName };
}

function renderGuideVocal({ storageDir, track, trackVersion, kind }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "guide_vocal.wav" : "guide_vocal_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 4 : 10,
    frequencyHz: 440,
  });
  return { file: fileName };
}

async function renderWithProvider({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  lyrics,
  musicPlan,
  onTaskId,
}) {
  if (providerConfig?.live) {
    // Select provider based on config (defaults to elevenlabs)
    const provider = providerConfig.provider || "elevenlabs";

    if (provider === "suno") {
      console.log(`[Music] Using Suno provider for track ${track.id}`);
      return generateMusicWithSuno({
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        storageDir,
        track,
        trackVersion,
        lyrics,
        musicPlan,
        timeoutMs: providerConfig.timeoutMs,
        kind,
        onTaskId,
      });
    }

    // Default: ElevenLabs
    console.log(`[Music] Using ElevenLabs provider for track ${track.id}`);
    return generateMusic({
      baseUrl: providerConfig.baseUrl,
      endpoint: providerConfig.endpoint,
      compositionPlanEndpoint: providerConfig.compositionPlanEndpoint,
      apiKey: providerConfig.apiKey,
      storageDir,
      track,
      trackVersion,
      lyrics,
      musicPlan,
      voiceId: providerConfig.voiceId,
      timeoutMs: providerConfig.timeoutMs,
      kind,
    });
  }
  return {
    ...(renderInstrumental({ storageDir, track, trackVersion, kind }) || {}),
    ...(renderGuideVocal({ storageDir, track, trackVersion, kind }) || {}),
  };
}

module.exports = {
  buildMusicPlan,
  buildStyleIntent,
  renderStyleIntentPrompt,
  renderInstrumental,
  renderGuideVocal,
  renderWithProvider,
  // Re-exported from style-registry for backward compatibility
  STYLES,
  STYLE_ALIASES,
  getStyleProfile,
  normalizeStyle,
  getStylePrompt,
  selectBpm,
  selectKey,
  calculateSections,
};
