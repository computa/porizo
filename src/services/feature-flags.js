/**
 * Feature Flags Service - Runtime configuration with DB-backed storage and caching
 */

const CACHE_TTL_MS = 60_000;

// Cache stores { value, fetchedAt } per flag for correct per-flag TTL
const cache = new Map();

const DEFAULTS = {
  // Voice enrollment flags
  'voice_enrollment_preprocessing_strategy': 'ffmpeg',
  'voice_enrollment_ml_provider': 'deepfilternet',
  'voice_enrollment_min_tier_for_conversion': 'minimal',
  'voice_enrollment_sung_threshold_relaxation': true,
  'voice_enrollment_sung_weight': 0.6,
  'voice_enrollment_ios_voice_processing': true,
  'voice_enrollment_ios_realtime_feedback': true,
  // Developer flags
  'show_design_screens': false,
  // Seed-VC voice conversion flags
  // cfgRate: Lower = natural singing, higher = voice similarity
  // Balanced default to improve voice match without over-cloning
  'seedvc_cfg_rate': 0.65,
  // diffusionSteps: Higher = better quality but slower
  // Use mid-range defaults to balance quality and latency
  'seedvc_diffusion_steps_preview': 60,
  'seedvc_diffusion_steps_full': 90,
  // Timbre blending: tint the AI vocal with user's voice instead of full replacement
  // blend_ratio: 0.0=pure AI vocals, 1.0=100% converted (legacy), sweet spot 0.15-0.4
  'timbre_blend_ratio': 0.25,
  // Cover-mode cfg when blending is active (lower = preserves more AI singing quality)
  'timbre_cfg_rate': 0.35,
  // Timbre blend strategy: which algorithm to use for vocal blending
  'timbre_blend_strategy': 'amplitude',
  // Spectral Crossover params
  'spectral_crossover_low_hz': 300,
  'spectral_crossover_high_hz': 3000,
  'spectral_mid_blend_ratio': 0.30,
  // Vocal Doubling params
  'doubling_level': 0.12,
  'doubling_presence_cut_freq': 4000,
  'doubling_presence_cut_gain': -8,
  // Formant Transfer params
  'formant_transfer_strength': 0.5,
  'formant_max_gain_db': 12,
  // Perceptual Primary params (user voice dominant, AI fills gaps)
  'perceptual_ai_influence': 0.15,
  'perceptual_ducking_strength': 0.85,
  'perceptual_attack_ms': 10,
  'perceptual_release_ms': 150,
};

/**
 * Feature flag metadata for admin UI display
 */
const FLAG_METADATA = {
  'seedvc_cfg_rate': {
    category: 'voice_conversion',
    label: 'CFG Rate',
    description: 'Voice fidelity vs natural singing balance. Lower values produce more natural singing, higher values increase voice similarity.',
    type: 'number',
    min: 0.1,
    max: 1.0,
    step: 0.05,
  },
  'seedvc_diffusion_steps_preview': {
    category: 'voice_conversion',
    label: 'Diffusion Steps (Preview)',
    description: 'Number of diffusion steps for preview renders. Higher values produce better quality but take longer.',
    type: 'number',
    min: 10,
    max: 200,
    step: 10,
  },
  'seedvc_diffusion_steps_full': {
    category: 'voice_conversion',
    label: 'Diffusion Steps (Full)',
    description: 'Number of diffusion steps for full renders. Higher values produce better quality but take longer.',
    type: 'number',
    min: 25,
    max: 300,
    step: 25,
  },
  'timbre_blend_ratio': {
    category: 'voice_conversion',
    label: 'Timbre Blend Ratio',
    description: 'Blend between AI vocals and converted vocals. 0.0=pure AI, 1.0=full conversion (legacy). Sweet spot: 0.15-0.4.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.05,
  },
  'timbre_cfg_rate': {
    category: 'voice_conversion',
    label: 'Timbre CFG Rate (Cover Mode)',
    description: 'CFG rate for voice conversion when timbre blending is active. Lower = more natural singing quality preserved.',
    type: 'number',
    min: 0.1,
    max: 0.8,
    step: 0.05,
  },
  'timbre_blend_strategy': {
    category: 'voice_conversion',
    label: 'Timbre Blend Strategy',
    description: 'Algorithm for blending AI and converted vocals. Amplitude=volume mix, Spectral=frequency-band split, Doubling=compressed subliminal double, Formant=EQ transfer.',
    type: 'string',
    options: [
      { value: 'amplitude', label: 'Amplitude Mix (Current)' },
      { value: 'spectral_crossover', label: 'Spectral Crossover' },
      { value: 'vocal_doubling', label: 'Compressed Vocal Doubling' },
      { value: 'formant_transfer', label: 'Formant Transfer' },
      { value: 'perceptual_primary', label: 'Perceptual Primary (User Dominant)' },
    ],
  },
  'spectral_crossover_low_hz': {
    category: 'voice_conversion',
    label: 'Spectral: Low Crossover (Hz)',
    description: 'Low frequency boundary for spectral crossover. Below this, AI vocal is used exclusively.',
    type: 'number',
    min: 100,
    max: 500,
    step: 50,
  },
  'spectral_crossover_high_hz': {
    category: 'voice_conversion',
    label: 'Spectral: High Crossover (Hz)',
    description: 'High frequency boundary for spectral crossover. Above this, AI vocal is used exclusively.',
    type: 'number',
    min: 2000,
    max: 5000,
    step: 250,
  },
  'spectral_mid_blend_ratio': {
    category: 'voice_conversion',
    label: 'Spectral: Mid Blend Ratio',
    description: 'How much converted vocal to blend in the formant band (300-3kHz). 0=pure AI, 1=pure converted.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.05,
  },
  'doubling_level': {
    category: 'voice_conversion',
    label: 'Doubling: Mix Level',
    description: 'Volume level of the compressed vocal double. 0.05=barely audible, 0.20=noticeable.',
    type: 'number',
    min: 0.02,
    max: 0.30,
    step: 0.02,
  },
  'doubling_presence_cut_freq': {
    category: 'voice_conversion',
    label: 'Doubling: Presence Cut Freq (Hz)',
    description: 'Center frequency for presence EQ cut on the double. Removes "second voice" articulation.',
    type: 'number',
    min: 2000,
    max: 6000,
    step: 500,
  },
  'doubling_presence_cut_gain': {
    category: 'voice_conversion',
    label: 'Doubling: Presence Cut (dB)',
    description: 'Gain reduction at presence frequency. More negative = more cut.',
    type: 'number',
    min: -15,
    max: 0,
    step: 1,
  },
  'formant_transfer_strength': {
    category: 'voice_conversion',
    label: 'Formant: Transfer Strength',
    description: 'How strongly to apply the formant EQ correction. 0=no effect, 1=full transfer.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.1,
  },
  'formant_max_gain_db': {
    category: 'voice_conversion',
    label: 'Formant: Max Gain (dB)',
    description: 'Maximum per-band EQ gain allowed during formant transfer.',
    type: 'number',
    min: 3,
    max: 20,
    step: 1,
  },
  'perceptual_ai_influence': {
    category: 'voice_conversion',
    label: 'Perceptual: AI Influence',
    description: 'How much AI vocal bleeds through when user voice is silent. 0=none, 0.5=max allowed.',
    type: 'number',
    min: 0.0,
    max: 0.5,
    step: 0.05,
  },
  'perceptual_ducking_strength': {
    category: 'voice_conversion',
    label: 'Perceptual: Ducking Strength',
    description: 'How aggressively AI ducks when user sings. 0=no ducking, 1=full ducking.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.05,
  },
  'perceptual_attack_ms': {
    category: 'voice_conversion',
    label: 'Perceptual: Attack (ms)',
    description: 'How fast the ducking kicks in when user starts singing.',
    type: 'number',
    min: 5,
    max: 100,
    step: 5,
  },
  'perceptual_release_ms': {
    category: 'voice_conversion',
    label: 'Perceptual: Release (ms)',
    description: 'How fast AI returns after user stops singing.',
    type: 'number',
    min: 50,
    max: 500,
    step: 25,
  },
  'voice_enrollment_preprocessing_strategy': {
    category: 'voice_enrollment',
    label: 'Preprocessing Strategy',
    description: 'Audio preprocessing method for voice enrollment.',
    type: 'string',
    options: [
      { value: 'ffmpeg', label: 'FFmpeg (Standard)' },
      { value: 'sox', label: 'SoX (Advanced)' },
      { value: 'none', label: 'None (Raw)' },
    ],
  },
  'voice_enrollment_ml_provider': {
    category: 'voice_enrollment',
    label: 'ML Provider',
    description: 'Machine learning provider for voice quality assessment.',
    type: 'string',
    options: [
      { value: 'deepfilternet', label: 'DeepFilterNet' },
      { value: 'silero', label: 'Silero VAD' },
      { value: 'webrtc', label: 'WebRTC VAD' },
    ],
  },
  'voice_enrollment_min_tier_for_conversion': {
    category: 'voice_enrollment',
    label: 'Min Tier for Conversion',
    description: 'Minimum voice quality tier required for voice conversion.',
    type: 'string',
    options: [
      { value: 'minimal', label: 'Minimal (Low Bar)' },
      { value: 'standard', label: 'Standard' },
      { value: 'premium', label: 'Premium (High Bar)' },
    ],
  },
  'voice_enrollment_sung_threshold_relaxation': {
    category: 'voice_enrollment',
    label: 'Sung Threshold Relaxation',
    description: 'Whether to use relaxed thresholds for sung audio quality checks.',
    type: 'boolean',
  },
  'voice_enrollment_sung_weight': {
    category: 'voice_enrollment',
    label: 'Sung Weight',
    description: 'Weight given to sung samples in overall quality scoring.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
  },
  'voice_enrollment_ios_voice_processing': {
    category: 'voice_enrollment',
    label: 'iOS Voice Processing',
    description: 'Enable iOS voice processing for enrollment recordings.',
    type: 'boolean',
  },
  'voice_enrollment_ios_realtime_feedback': {
    category: 'voice_enrollment',
    label: 'iOS Realtime Feedback',
    description: 'Enable realtime audio level feedback during enrollment on iOS.',
    type: 'boolean',
  },
  'show_design_screens': {
    category: 'developer',
    label: 'Show Design Screens',
    description: 'Make design preview screens accessible in TestFlight and debug builds. Never visible on App Store.',
    type: 'boolean',
  },
};

/**
 * Get a feature flag value
 * @param {Object} db - Database instance
 * @param {string} flagId - Flag identifier
 * @param {Object} options - Options
 * @param {boolean} options.throwOnError - If true, throws on DB errors instead of falling back to defaults
 * @returns {Promise<any>} Flag value (parsed from JSON)
 */
async function getFeatureFlag(db, flagId, { throwOnError = false } = {}) {
  const now = Date.now();
  const cached = cache.get(flagId);

  // Per-flag TTL check
  if (cached && (now - cached.fetchedAt < CACHE_TTL_MS)) {
    return cached.value;
  }

  try {
    const row = await db.prepare(
      'SELECT value FROM feature_flags WHERE id = ?'
    ).get(flagId);

    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      cache.set(flagId, { value: parsed, fetchedAt: now });
      return parsed;
    }
    // Flag not found in DB - use default (this is expected for new flags)
    return DEFAULTS[flagId] ?? null;
  } catch (e) {
    console.error(`[FeatureFlags] FF001_DB_READ_ERROR: Failed to get flag ${flagId}:`, e.message);
    if (throwOnError) {
      throw new Error(`FF001_DB_READ_ERROR: Database error reading flag ${flagId}: ${e.message}`);
    }
    // Fall back to default on error (graceful degradation for worker resilience)
    return DEFAULTS[flagId] ?? null;
  }
}

/**
 * Get multiple feature flags at once
 * @param {Object} db - Database instance
 * @param {string[]} flagIds - Array of flag identifiers
 * @param {Object} options - Options
 * @param {boolean} options.throwOnError - If true, throws on DB errors instead of falling back to defaults
 * @returns {Promise<Object>} Object with flag values keyed by flag ID
 */
async function getFeatureFlags(db, flagIds, { throwOnError = false } = {}) {
  const result = {};

  try {
    const placeholders = flagIds.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id, value FROM feature_flags WHERE id IN (${placeholders})`
    ).all(...flagIds);

    const dbValues = new Map();
    for (const row of rows) {
      try {
        dbValues.set(row.id, JSON.parse(row.value));
      } catch (e) {
        console.error(`[FeatureFlags] FF002_PARSE_ERROR: Failed to parse value for flag ${row.id}:`, e.message);
        // Continue with other flags - corrupted data shouldn't break everything
      }
    }

    for (const flagId of flagIds) {
      result[flagId] = dbValues.get(flagId) ?? DEFAULTS[flagId] ?? null;
    }
  } catch (e) {
    console.error('[FeatureFlags] FF003_BATCH_READ_ERROR: Failed to batch get flags:', e.message);
    if (throwOnError) {
      throw new Error(`FF003_BATCH_READ_ERROR: Database error reading flags: ${e.message}`);
    }
    // Fall back to defaults on error (graceful degradation)
    for (const flagId of flagIds) {
      result[flagId] = DEFAULTS[flagId] ?? null;
    }
  }

  return result;
}

/**
 * Set a feature flag value
 * @param {Object} db - Database instance
 * @param {string} flagId - Flag identifier
 * @param {any} value - Value to set (will be JSON stringified)
 * @param {string} updatedBy - User/system that updated the flag
 * @returns {Promise<void>}
 */
async function setFeatureFlag(db, flagId, value, updatedBy = 'system') {
  const jsonValue = JSON.stringify(value);
  const now = new Date().toISOString();

  try {
    await db.prepare(
      `INSERT INTO feature_flags (id, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    ).run(flagId, jsonValue, now, updatedBy);

    // Only update cache after successful DB write
    cache.set(flagId, { value, fetchedAt: Date.now() });
  } catch (e) {
    console.error(`[FeatureFlags] FF004_WRITE_ERROR: Failed to set flag ${flagId}:`, e.message);
    throw new Error(`FF004_WRITE_ERROR: Failed to save flag ${flagId}: ${e.message}`);
  }
}

/**
 * Get all voice enrollment flags
 * @param {Object} db - Database instance
 * @returns {Promise<Object>} All voice enrollment configuration
 */
async function getVoiceEnrollmentConfig(db) {
  const flagIds = Object.keys(DEFAULTS).filter(k => k.startsWith('voice_enrollment_'));
  return getFeatureFlags(db, flagIds);
}

/**
 * Clear the cache (useful after bulk updates)
 */
function clearCache() {
  cache.clear();
}

module.exports = {
  getFeatureFlag,
  getFeatureFlags,
  setFeatureFlag,
  getVoiceEnrollmentConfig,
  clearCache,
  DEFAULTS,
  FLAG_METADATA,
};
