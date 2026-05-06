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
  // Global My Voice visibility toggle for clients and backend routing.
  // When false, clients hide the option and backend coerces user_voice -> ai_voice.
  'my_voice_enabled': true,
  // Gift delivery feature gates.
  'gift_scheduling_enabled': true,
  'gift_prepay_enforced': false,
  'gift_sms_enabled': true,
  'gift_email_enabled': true,
  'gift_require_app_claim': true,
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
  // Vocal Polish params (post-process Seed-VC output)
  'vocal_polish_enabled': true,
  'vocal_polish_de_harsh_freq': 3000,
  'vocal_polish_de_harsh_gain': -3,
  'vocal_polish_warmth_freq': 200,
  'vocal_polish_warmth_gain': 2,
  // Previously hardcoded polish params (now tunable)
  'vocal_polish_highpass_freq': 80,
  'vocal_polish_lowpass_freq': 12000,
  'vocal_polish_compression_ratio': 4,
  'vocal_polish_compression_threshold': 0.1,
  // De-essing params (new)
  'vocal_polish_de_ess_freq': 6500,
  'vocal_polish_de_ess_gain': -4,
  'vocal_polish_de_ess_width': 2.0,
  // Seed-VC params (previously hardcoded in voice.js)
  'seedvc_auto_f0_adjust': false,
  'seedvc_f0_condition': true,
  'seedvc_pitch_shift': 0,
  // Voice Conversion Provider Selection
  // 'seedvc' = Seed-VC (free HF Space), 'elevenlabs' = ElevenLabs Voice Changer API
  'voice_conversion_provider': 'seedvc',
  'suno_voice_persona_model': 'V5_5',
  'suno_voice_persona_persona_model': 'voice_persona',
  'suno_voice_persona_enabled': true,
  // Used by the persona preparation cover/upload path, not the final generate request.
  'suno_voice_persona_audio_weight': 0.85,
  // ElevenLabs Voice Changer settings
  // stability: How consistent the voice sounds. Lower = more expressive/melodic, higher = more monotone.
  // For singing, keep LOW (0.3-0.5) to preserve melodic contour.
  'elevenlabs_stability': 0.40,
  // similarityBoost: How closely to match the cloned voice. Higher = stronger voice match.
  'elevenlabs_similarity_boost': 0.85,
  // Free tier one-off grants (admin-configurable)
  'free_tier_songs_grant': 1,
  'free_tier_poems_grant': 1,
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
  'vocal_polish_enabled': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Enabled',
    description: 'Apply post-processing to Seed-VC output to reduce harshness and add warmth.',
    type: 'boolean',
  },
  'vocal_polish_de_harsh_freq': {
    category: 'voice_conversion',
    label: 'Vocal Polish: De-Harsh Freq (Hz)',
    description: 'Center frequency for harshness reduction EQ cut.',
    type: 'number',
    min: 1000,
    max: 5000,
    step: 250,
  },
  'vocal_polish_de_harsh_gain': {
    category: 'voice_conversion',
    label: 'Vocal Polish: De-Harsh Gain (dB)',
    description: 'How much to cut at the harsh frequency. More negative = more cut.',
    type: 'number',
    min: -8,
    max: 0,
    step: 1,
  },
  'vocal_polish_warmth_freq': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Warmth Freq (Hz)',
    description: 'Center frequency for warmth boost.',
    type: 'number',
    min: 100,
    max: 400,
    step: 25,
  },
  'vocal_polish_warmth_gain': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Warmth Gain (dB)',
    description: 'How much warmth to add. Higher = warmer.',
    type: 'number',
    min: 0,
    max: 6,
    step: 1,
  },
  'vocal_polish_highpass_freq': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Highpass Freq (Hz)',
    description: 'Remove rumble below this frequency.',
    type: 'number',
    min: 40,
    max: 150,
    step: 10,
  },
  'vocal_polish_lowpass_freq': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Lowpass Freq (Hz)',
    description: 'Remove artifacts above this frequency.',
    type: 'number',
    min: 8000,
    max: 16000,
    step: 500,
  },
  'vocal_polish_compression_ratio': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Compression Ratio',
    description: 'Dynamic range compression ratio. Higher = more compression.',
    type: 'number',
    min: 2,
    max: 8,
    step: 1,
  },
  'vocal_polish_compression_threshold': {
    category: 'voice_conversion',
    label: 'Vocal Polish: Compression Threshold',
    description: 'Compression threshold (0-1). Lower = more compression applied.',
    type: 'number',
    min: 0.05,
    max: 0.3,
    step: 0.05,
  },
  'vocal_polish_de_ess_freq': {
    category: 'voice_conversion',
    label: 'Vocal Polish: De-Ess Freq (Hz)',
    description: 'Center frequency for sibilance reduction. Sibilance typically lives at 5-8kHz.',
    type: 'number',
    min: 4000,
    max: 9000,
    step: 500,
  },
  'vocal_polish_de_ess_gain': {
    category: 'voice_conversion',
    label: 'Vocal Polish: De-Ess Gain (dB)',
    description: 'How much to cut sibilance. More negative = more reduction. 0 = disabled.',
    type: 'number',
    min: -12,
    max: 0,
    step: 1,
  },
  'vocal_polish_de_ess_width': {
    category: 'voice_conversion',
    label: 'Vocal Polish: De-Ess Width (Q)',
    description: 'Bandwidth of the de-essing EQ. Wider = affects more frequencies around center.',
    type: 'number',
    min: 0.5,
    max: 4.0,
    step: 0.5,
  },
  'seedvc_auto_f0_adjust': {
    category: 'voice_conversion',
    label: 'Seed-VC: Auto F0 Adjust',
    description: 'Automatically adjust fundamental frequency to match target voice pitch range.',
    type: 'boolean',
  },
  'seedvc_f0_condition': {
    category: 'voice_conversion',
    label: 'Seed-VC: F0 Condition',
    description: 'Condition on source F0 contour during conversion. Preserves original pitch dynamics.',
    type: 'boolean',
  },
  'seedvc_pitch_shift': {
    category: 'voice_conversion',
    label: 'Seed-VC: Pitch Shift (semitones)',
    description: 'Shift pitch up or down in semitones. 0 = no shift.',
    type: 'number',
    min: -12,
    max: 12,
    step: 1,
  },
  'voice_conversion_provider': {
    category: 'voice_conversion',
    label: 'Voice Conversion Provider',
    description: 'Which provider to use for voice conversion. seedvc=free Seed-VC, elevenlabs=ElevenLabs Voice Changer (~$0.10/preview).',
    type: 'select',
    options: ['seedvc', 'elevenlabs'],
  },
  'suno_voice_persona_model': {
    category: 'voice_conversion',
    label: 'Suno Persona Generation Model',
    description: 'Suno model used for user-voice persona song generation after the provider persona exists.',
    type: 'select',
    options: ['V5_5', 'V5', 'V4_5'],
  },
  'suno_voice_persona_persona_model': {
    category: 'voice_conversion',
    label: 'Suno Persona Model',
    description: 'Persona mode sent with personaId for final Suno generation. voice_persona is voice-focused.',
    type: 'string',
    options: ['voice_persona'],
  },
  'suno_voice_persona_audio_weight': {
    category: 'voice_conversion',
    label: 'Suno Persona Audio Weight',
    description: 'Reference-audio weight for the persona preparation cover/upload path.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.05,
  },
  'suno_voice_persona_enabled': {
    category: 'voice_conversion',
    label: 'Suno Voice Persona Enabled',
    description: 'Backend kill switch for queueing Suno voice-persona profile creation.',
    type: 'boolean',
  },
  'my_voice_enabled': {
    category: 'voice_conversion',
    label: 'My Voice Option Enabled',
    description: 'Global toggle for personalized voice. OFF hides "My Voice" in clients and routes user_voice requests to AI voice.',
    type: 'boolean',
  },
  'gift_scheduling_enabled': {
    category: 'developer',
    label: 'Gift Scheduling Enabled',
    description: 'Master switch for scheduled/immediate gifting APIs.',
    type: 'boolean',
  },
  'gift_prepay_enforced': {
    category: 'developer',
    label: 'Gift Prepay Enforced',
    description: 'Requires reservation-first flow before gift content creation/finalization.',
    type: 'boolean',
  },
  'gift_sms_enabled': {
    category: 'developer',
    label: 'Gift SMS Delivery Enabled',
    description: 'Allows SMS channel dispatch for gift delivery.',
    type: 'boolean',
  },
  'gift_email_enabled': {
    category: 'developer',
    label: 'Gift Email Delivery Enabled',
    description: 'Allows email channel dispatch for gift delivery.',
    type: 'boolean',
  },
  'gift_require_app_claim': {
    category: 'developer',
    label: 'Gift Requires App Claim',
    description: 'For gifted shares, disables web playback and requires app claim before access.',
    type: 'boolean',
  },
  'elevenlabs_stability': {
    category: 'voice_conversion',
    label: 'ElevenLabs: Stability',
    description: 'Voice consistency. LOW (0.3-0.5) preserves melodic contour for singing. HIGH (0.8-1.0) sounds flat/robotic.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.05,
  },
  'elevenlabs_similarity_boost': {
    category: 'voice_conversion',
    label: 'ElevenLabs: Similarity Boost',
    description: 'How closely to match the cloned voice. Higher = stronger voice match but may amplify artifacts.',
    type: 'number',
    min: 0.0,
    max: 1.0,
    step: 0.05,
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
  'free_tier_songs_grant': {
    category: 'entitlements',
    label: 'Free Tier Songs Grant',
    description: 'Number of songs granted to new free accounts on creation. Set to 0 to disable.',
    type: 'number',
    min: 0,
    max: 10,
    step: 1,
  },
  'free_tier_poems_grant': {
    category: 'entitlements',
    label: 'Free Tier Poems Grant',
    description: 'Number of poems granted to new free accounts on creation. Set to 0 to disable.',
    type: 'number',
    min: 0,
    max: 10,
    step: 1,
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
    const statement = db.prepare(
      `SELECT id, value FROM feature_flags WHERE id IN (${placeholders})`
    );
    if (typeof statement.all !== "function") {
      for (const flagId of flagIds) {
        result[flagId] = await getFeatureFlag(db, flagId, { throwOnError });
      }
      return result;
    }
    const rows = await statement.all(...flagIds);

    const dbValues = new Map();
    const now = Date.now();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        dbValues.set(row.id, parsed);
        // SVC-15: Populate per-flag cache with TTL on batch reads
        cache.set(row.id, { value: parsed, fetchedAt: now });
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
