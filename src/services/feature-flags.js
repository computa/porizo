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
  // Seed-VC voice conversion flags
  // cfgRate: Lower = natural singing, higher = voice similarity
  'seedvc_cfg_rate': 0.4,
  // diffusionSteps: Higher = better quality but slower
  'seedvc_diffusion_steps_preview': 50,
  'seedvc_diffusion_steps_full': 100,
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
  'voice_enrollment_preprocessing_strategy': {
    category: 'voice_enrollment',
    label: 'Preprocessing Strategy',
    description: 'Audio preprocessing method for voice enrollment.',
    type: 'string',
  },
  'voice_enrollment_ml_provider': {
    category: 'voice_enrollment',
    label: 'ML Provider',
    description: 'Machine learning provider for voice quality assessment.',
    type: 'string',
  },
  'voice_enrollment_min_tier_for_conversion': {
    category: 'voice_enrollment',
    label: 'Min Tier for Conversion',
    description: 'Minimum voice quality tier required for voice conversion.',
    type: 'string',
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
