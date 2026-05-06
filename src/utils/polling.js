/**
 * Polling Utilities
 *
 * Shared exponential backoff polling for external API calls.
 * Prevents overwhelming external services during outages.
 */
const {
  SUNO_MAX_POLL_ATTEMPTS,
  SUNO_POLL_INITIAL_INTERVAL_MS,
  SUNO_POLL_MAX_INTERVAL_MS,
  REPLICATE_MAX_POLL_ATTEMPTS,
  REPLICATE_POLL_INITIAL_INTERVAL_MS,
  REPLICATE_POLL_MAX_INTERVAL_MS,
} = require("../config");

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add jitter to an interval to prevent thundering herd
 * @param {number} interval - Base interval in ms
 * @param {number} jitterPct - Jitter percentage (0-1)
 * @returns {number} Interval with jitter
 */
function addJitter(interval, jitterPct = 0.1) {
  const jitter = interval * jitterPct * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(interval + jitter));
}

/**
 * Poll with exponential backoff
 *
 * @param {Function} checkFn - Async function that returns { done: boolean, ...data }
 * @param {Object} options - Polling options
 * @param {number} options.maxAttempts - Maximum polling attempts (default: 60)
 * @param {number} options.initialIntervalMs - Initial interval in ms (default: 2000)
 * @param {number} options.maxIntervalMs - Maximum interval in ms (default: 30000)
 * @param {number} options.backoffFactor - Backoff multiplier (default: 1.5)
 * @param {number} options.jitterPct - Jitter percentage (default: 0.1)
 * @param {Function} options.onPoll - Optional callback on each poll (attempt, interval)
 * @returns {Promise<Object>} Final result from checkFn
 * @throws {Error} If max attempts exceeded or checkFn throws
 */
async function pollWithBackoff(checkFn, options = {}) {
  const {
    maxAttempts = 60,
    initialIntervalMs = 2000,
    maxIntervalMs = 30000,
    backoffFactor = 1.5,
    jitterPct = 0.1,
    onPoll = null,
    // H10: optional async predicate. Checked before each poll iteration; if
    // it returns truthy, abort with `E302_POLL_ABORTED`. Used by the persona
    // worker to honor `voice_provider_jobs.cancellation_requested_at` mid-poll
    // (otherwise an in-flight poll runs to completion before cancellation
    // surfaces, billing one extra Suno cover task per re-enrollment burst).
    shouldAbort = null,
  } = options;

  let interval = initialIntervalMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (typeof shouldAbort === "function") {
      const aborted = await shouldAbort();
      if (aborted) {
        const reason =
          typeof aborted === "string" ? aborted : "cancellation_requested";
        throw new Error(`E302_POLL_ABORTED: ${reason}`);
      }
    }

    const result = await checkFn();

    if (result.done) {
      return result;
    }

    if (result.failed) {
      throw new Error(result.error || "Polling failed");
    }

    // Call optional progress callback
    if (onPoll) {
      onPoll(attempt, interval);
    }

    // Wait with jitter before next attempt
    const waitMs = addJitter(interval, jitterPct);
    await sleep(waitMs);

    // Increase interval for next attempt (exponential backoff)
    interval = Math.min(interval * backoffFactor, maxIntervalMs);
  }

  throw new Error(`Polling timeout: exceeded ${maxAttempts} attempts`);
}

/**
 * Create a polling configuration for a specific provider
 *
 * @param {string} provider - Provider name (for logging)
 * @param {Object} overrides - Override default options
 * @returns {Object} Polling configuration
 */
function createPollingConfig(provider, overrides = {}) {
  // Use config values for polling defaults (configurable via env vars)
  const defaults = {
    suno: {
      maxAttempts: SUNO_MAX_POLL_ATTEMPTS,
      initialIntervalMs: SUNO_POLL_INITIAL_INTERVAL_MS,
      maxIntervalMs: SUNO_POLL_MAX_INTERVAL_MS,
    },
    replicate: {
      maxAttempts: REPLICATE_MAX_POLL_ATTEMPTS,
      initialIntervalMs: REPLICATE_POLL_INITIAL_INTERVAL_MS,
      maxIntervalMs: REPLICATE_POLL_MAX_INTERVAL_MS,
    },
    elevenlabs: {
      maxAttempts: 30,
      initialIntervalMs: 1000,
      maxIntervalMs: 10000,
    },
  };

  const providerDefaults = defaults[provider] || {};
  return { ...providerDefaults, ...overrides };
}

module.exports = {
  sleep,
  addJitter,
  pollWithBackoff,
  createPollingConfig,
};
