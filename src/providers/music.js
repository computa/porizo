const path = require("path");
const { generateMusic } = require("./elevenlabs");
const { generateMusicWithSuno } = require("./suno");
const { writeWav } = require("../utils/audio");

/**
 * Style profiles with genre-appropriate BPM ranges and key signatures
 * BPM ranges optimized for each genre's typical feel
 */
const STYLE_PROFILES = {
  // Western Pop/Contemporary
  pop: { bpmRange: [100, 130], keys: ["C", "G", "D", "A"], energy: "medium" },
  acoustic: { bpmRange: [80, 110], keys: ["G", "D", "C", "A"], energy: "low" },
  soul: { bpmRange: [60, 90], keys: ["Eb", "Ab", "Bb", "F"], energy: "medium" },
  folk: { bpmRange: [90, 120], keys: ["G", "D", "C", "A"], energy: "low" },
  jazz: { bpmRange: [100, 140], keys: ["Bb", "F", "Eb", "Ab"], energy: "medium" },
  rnb: { bpmRange: [60, 90], keys: ["Eb", "Ab", "Db", "Gb"], energy: "low" },
  rock: { bpmRange: [110, 140], keys: ["E", "A", "D", "G"], energy: "high" },
  country: { bpmRange: [90, 130], keys: ["G", "C", "D", "A"], energy: "medium" },
  ballad: { bpmRange: [60, 80], keys: ["C", "G", "F", "Am"], energy: "low" },

  // African styles
  afrobeats: { bpmRange: [95, 115], keys: ["Eb", "Bb", "F", "Ab"], energy: "high" },
  highlife: { bpmRange: [100, 120], keys: ["F", "Bb", "C", "G"], energy: "medium" },
  ogene: { bpmRange: [90, 110], keys: ["G", "C", "D"], energy: "high" },
  juju: { bpmRange: [95, 115], keys: ["A", "D", "E"], energy: "medium" },
  fuji: { bpmRange: [90, 110], keys: ["D", "G", "A"], energy: "high" },
  afropop: { bpmRange: [100, 120], keys: ["F", "Bb", "Eb", "C"], energy: "medium" },

  // Latin/South American styles
  reggaeton: { bpmRange: [85, 100], keys: ["Am", "Dm", "Em", "Gm"], energy: "high" },
  salsa: { bpmRange: [160, 200], keys: ["C", "F", "Bb", "G"], energy: "high" },
  bossa_nova: { bpmRange: [120, 145], keys: ["D", "G", "A", "E"], energy: "low" },
  cumbia: { bpmRange: [85, 105], keys: ["D", "G", "A", "E"], energy: "medium" },
  bachata: { bpmRange: [125, 145], keys: ["Am", "Dm", "Em", "G"], energy: "medium" },
  samba: { bpmRange: [96, 110], keys: ["D", "G", "A", "E"], energy: "high" },
  latin_pop: { bpmRange: [100, 130], keys: ["C", "F", "G", "Am"], energy: "medium" },
};

// Default profile for unknown styles
const DEFAULT_PROFILE = { bpmRange: [100, 120], keys: ["C", "G", "D", "A"], energy: "medium" };

/**
 * Get style profile with fallback to default
 * @param {string} style - Music style key
 * @returns {Object} Style profile
 */
function getStyleProfile(style) {
  return STYLE_PROFILES[style?.toLowerCase()] || DEFAULT_PROFILE;
}

/**
 * Generate random BPM within style's range
 * @param {Object} profile - Style profile
 * @returns {number} BPM value
 */
function selectBpm(profile) {
  const [min, max] = profile.bpmRange;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Select key appropriate for style
 * @param {Object} profile - Style profile
 * @returns {string} Musical key
 */
function selectKey(profile) {
  const keys = profile.keys;
  return keys[Math.floor(Math.random() * keys.length)];
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
function buildMusicPlan({ style, durationTarget }) {
  const duration = durationTarget || 60;
  const profile = getStyleProfile(style);
  const bpm = selectBpm(profile);
  const key = selectKey(profile);
  const sections = calculateSections(duration, bpm);

  return {
    bpm,
    key,
    duration_sec: duration,
    style: style || "pop",
    energy: profile.energy,
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
  renderInstrumental,
  renderGuideVocal,
  renderWithProvider,
  // Style-aware helpers (exported for testing)
  STYLE_PROFILES,
  getStyleProfile,
  selectBpm,
  selectKey,
  calculateSections,
};
