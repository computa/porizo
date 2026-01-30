/**
 * Feature Flags Service - Runtime configuration with DB-backed storage and caching
 */

const CACHE_TTL_MS = 60_000;

// Cache stores { value, fetchedAt } per flag for correct per-flag TTL
const cache = new Map();

const DEFAULTS = {
  'voice_enrollment_preprocessing_strategy': 'ffmpeg',
  'voice_enrollment_ml_provider': 'deepfilternet',
  'voice_enrollment_min_tier_for_conversion': 'minimal',
  'voice_enrollment_sung_threshold_relaxation': true,
  'voice_enrollment_sung_weight': 0.6,
  'voice_enrollment_ios_voice_processing': true,
  'voice_enrollment_ios_realtime_feedback': true,
};

/**
 * Get a feature flag value
 * @param {Object} db - Database instance
 * @param {string} flagId - Flag identifier
 * @returns {Promise<any>} Flag value (parsed from JSON)
 */
async function getFeatureFlag(db, flagId) {
  const now = Date.now();
  const cached = cache.get(flagId);

  // Per-flag TTL check
  if (cached && (now - cached.fetchedAt < CACHE_TTL_MS)) {
    return cached.value;
  }

  try {
    const row = await db.get(
      'SELECT value FROM feature_flags WHERE id = ?',
      [flagId]
    );

    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      cache.set(flagId, { value: parsed, fetchedAt: now });
      return parsed;
    }
  } catch (e) {
    console.warn(`[FeatureFlags] Failed to get flag ${flagId}:`, e.message);
  }

  return DEFAULTS[flagId] ?? null;
}

/**
 * Get multiple feature flags at once
 * @param {Object} db - Database instance
 * @param {string[]} flagIds - Array of flag identifiers
 * @returns {Promise<Object>} Object with flag values keyed by flag ID
 */
async function getFeatureFlags(db, flagIds) {
  const result = {};

  try {
    const placeholders = flagIds.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT id, value FROM feature_flags WHERE id IN (${placeholders})`,
      flagIds
    );

    const dbValues = new Map();
    for (const row of rows) {
      try {
        dbValues.set(row.id, JSON.parse(row.value));
      } catch (e) {
        console.warn(`[FeatureFlags] Failed to parse value for flag ${row.id}:`, e.message);
      }
    }

    for (const flagId of flagIds) {
      result[flagId] = dbValues.get(flagId) ?? DEFAULTS[flagId] ?? null;
    }
  } catch (e) {
    console.warn('[FeatureFlags] Failed to batch get flags:', e.message);
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

  await db.run(
    `INSERT INTO feature_flags (id, value, updated_at, updated_by)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT (id) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
    [flagId, jsonValue, updatedBy]
  );

  cache.set(flagId, { value, fetchedAt: Date.now() });
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
};
