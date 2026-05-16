// Audio render and artwork render run in parallel; this barrier waits up to
// TIMEOUT for artwork to finish before letting the track flip to READY.
// Failed artwork must not gate audio — operator-supplied values outside the
// clamped range fall back to defaults rather than wedging the runner.
const TIMEOUT_DEFAULT_MS = 60_000;
const TIMEOUT_MIN_MS = 5_000;
const TIMEOUT_MAX_MS = 600_000; // a single audio render shouldn't outlast 10 min

const POLL_DEFAULT_MS = 1_000;
const POLL_MIN_MS = 250;
const POLL_MAX_MS = 30_000;

function clampInt(raw, defaultValue, min, max) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

const ARTWORK_BARRIER_TIMEOUT_MS = clampInt(
  process.env.ARTWORK_BARRIER_TIMEOUT_MS,
  TIMEOUT_DEFAULT_MS,
  TIMEOUT_MIN_MS,
  TIMEOUT_MAX_MS,
);
const ARTWORK_BARRIER_POLL_MS = clampInt(
  process.env.ARTWORK_BARRIER_POLL_MS,
  POLL_DEFAULT_MS,
  POLL_MIN_MS,
  POLL_MAX_MS,
);

const SQL_MARK_AUDIO_READY = `
  UPDATE track_versions SET audio_ready = ?
  WHERE id = ?
`;

const SQL_CHECK_ARTWORK_READY = `
  SELECT artwork_ready FROM track_versions WHERE id = ?
`;

/**
 * Mark audio_ready = true on a specific track_version row.
 * Idempotent — safe to call multiple times.
 */
async function markAudioReady({ db, trackVersionId }) {
  if (!db || !trackVersionId) {
    throw new Error("markAudioReady requires db and trackVersionId");
  }
  await db
    .prepare(SQL_MARK_AUDIO_READY)
    .run(boolToDbValue(true), trackVersionId);
}

/**
 * Poll `track_versions.artwork_ready` until it's true or the timeout elapses.
 *
 * Returns:
 *   - `true` if artwork became ready before the timeout
 *   - `false` if the timeout elapsed first (audio still releases — see plan §Failure policy)
 *
 * Polls every ARTWORK_BARRIER_POLL_MS (default 1s) up to ARTWORK_BARRIER_TIMEOUT_MS
 * (default 60s). Both overridable via env for testing.
 *
 * @param {Object} args
 * @param {Object} args.db
 * @param {string} args.trackVersionId
 * @param {number} [args.timeoutMs]   Overrides ARTWORK_BARRIER_TIMEOUT_MS
 * @param {number} [args.pollMs]      Overrides ARTWORK_BARRIER_POLL_MS
 * @param {Object} [args.logger]
 * @param {Function} [args.sleepFn]   Injected for tests
 * @returns {Promise<boolean>}
 */
async function waitForArtworkReady({
  db,
  trackVersionId,
  timeoutMs = ARTWORK_BARRIER_TIMEOUT_MS,
  pollMs = ARTWORK_BARRIER_POLL_MS,
  logger = console,
  sleepFn = sleep,
} = {}) {
  if (!db || !trackVersionId) {
    throw new Error("waitForArtworkReady requires db and trackVersionId");
  }
  const deadline = Date.now() + timeoutMs;
  let logged = false;
  let currentPoll = pollMs;
  // Cap exponential growth so a 60s wait still produces ~6-8 polls (not 60).
  const maxPoll = Math.max(pollMs, Math.min(timeoutMs / 6, 10_000));

  while (Date.now() < deadline) {
    let row;
    try {
      row = await db.prepare(SQL_CHECK_ARTWORK_READY).get(trackVersionId);
    } catch (err) {
      logger.warn(
        `[ArtworkBarrier] Query failed for ${trackVersionId}: ${err.message}. ` +
          `Releasing audio without artwork.`,
      );
      return false;
    }
    if (row && rowIsTrue(row.artwork_ready)) {
      return true;
    }
    if (!logged) {
      logger.info(
        `[ArtworkBarrier] Audio ready, waiting up to ${timeoutMs}ms for artwork on track_version ${trackVersionId}`,
      );
      logged = true;
    }
    await sleepFn(currentPoll);
    // Exponential backoff — at scale, polling every 1s × N concurrent renders
    // for 60s thrashes the DB. Smooth it.
    currentPoll = Math.min(maxPoll, Math.round(currentPoll * 1.4));
  }

  logger.warn(
    `[ArtworkBarrier] Timeout (${timeoutMs}ms) waiting for artwork on track_version ${trackVersionId}. ` +
      `Releasing track READY with artwork_url=NULL.`,
  );
  return false;
}

function rowIsTrue(v) {
  // PG returns boolean true; SQLite returns integer 1
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

function boolToDbValue(v) {
  return v ? 1 : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  markAudioReady,
  waitForArtworkReady,
  ARTWORK_BARRIER_TIMEOUT_MS,
  ARTWORK_BARRIER_POLL_MS,
  SQL_MARK_AUDIO_READY,
  SQL_CHECK_ARTWORK_READY,
};
