// Audio render and artwork render run in parallel; this barrier waits up to
// TIMEOUT for artwork to finish before letting the track flip to READY.
// Failed artwork must not gate audio — operator-supplied values outside the
// clamped range fall back to defaults rather than wedging the runner.
//
// Two paths: PG uses LISTEN/NOTIFY (push) for sub-second latency; SQLite (test
// suite and any non-PG runtime) keeps the exponential polling fallback.

const { EventEmitter } = require("events");

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

const SQL_CHECK_ARTWORK_READY = `
  SELECT artwork_ready FROM track_versions WHERE id = ?
`;

// PG NOTIFY plumbing — one shared listener per process, fanning out to local
// waiters via an EventEmitter. Avoids pool exhaustion under concurrent renders
// (each barrier would otherwise hold a dedicated client for up to 60s).
const NOTIFY_CHANNEL = "artwork_ready";
const localBus = new EventEmitter();
localBus.setMaxListeners(0); // many concurrent barriers may listen
let listenerClient = null;
let listenerSetup = null;

async function ensureListener(db, logger) {
  if (listenerClient) return;
  if (listenerSetup) return listenerSetup;
  if (!db._pool || typeof db._pool.connect !== "function") {
    // Driver doesn't expose a pool — fall through to polling.
    return null;
  }
  listenerSetup = (async () => {
    const client = await db._pool.connect();
    client.on("notification", (msg) => {
      if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
        localBus.emit(msg.payload);
      }
    });
    client.on("error", (err) => {
      (logger || console).warn(
        `[ArtworkBarrier] LISTEN client error: ${err.message}. Falling back to polling.`,
      );
      try {
        client.release(err);
      } catch {
        // ignore — pool already discarded
      }
      listenerClient = null;
      listenerSetup = null;
    });
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    listenerClient = client;
  })().catch((err) => {
    (logger || console).warn(
      `[ArtworkBarrier] LISTEN setup failed: ${err.message}. Falling back to polling.`,
    );
    listenerSetup = null;
    listenerClient = null;
    return null;
  });
  return listenerSetup;
}

/**
 * Wait for `track_versions.artwork_ready` to flip to true.
 *
 * On PG: registers a LISTEN handler keyed to `trackVersionId` and races
 * against the timeout. An initial SELECT covers the race where the NOTIFY
 * fires before LISTEN is registered.
 *
 * On SQLite (and any driver without a pool): exponential polling.
 *
 * @returns {Promise<boolean>} true if artwork became ready before timeout
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

  if (db.isPostgres) {
    const ok = await waitViaListen({
      db,
      trackVersionId,
      timeoutMs,
      logger,
    });
    if (ok !== null) return ok;
    // setup failed — fall through to polling path below.
  }

  return waitViaPolling({
    db,
    trackVersionId,
    timeoutMs,
    pollMs,
    logger,
    sleepFn,
  });
}

async function waitViaListen({ db, trackVersionId, timeoutMs, logger }) {
  await ensureListener(db, logger);
  if (!listenerClient) return null; // setup failed; caller will fall back

  // Race-cover: NOTIFY may have fired between job completion and our LISTEN
  // registration. Check current state once before subscribing. Swallow the
  // throw — we'd rather wait via LISTEN than fail the barrier on a transient
  // hiccup.
  try {
    if (await checkArtworkReady(db, trackVersionId, logger)) return true;
  } catch {
    // proceed to LISTEN wait
  }

  return new Promise((resolve) => {
    const onNotify = () => {
      clearTimeout(timer);
      localBus.off(trackVersionId, onNotify);
      resolve(true);
    };
    const timer = setTimeout(async () => {
      localBus.off(trackVersionId, onNotify);
      // One last DB check at deadline — covers the case where NOTIFY was
      // dropped (rare) but the row IS updated. Must be try/catch — a throw
      // here would leave the outer promise unresolved forever.
      try {
        const ready = await checkArtworkReady(db, trackVersionId, logger);
        if (ready) {
          resolve(true);
          return;
        }
      } catch {
        // fall through to timeout warning
      }
      logger.warn(
        `[ArtworkBarrier] Timeout (${timeoutMs}ms) on track_version ${trackVersionId}. ` +
          `Releasing READY with artwork_url=NULL.`,
      );
      resolve(false);
    }, timeoutMs);
    localBus.once(trackVersionId, onNotify);
    logger.info(
      `[ArtworkBarrier] LISTEN registered for track_version ${trackVersionId} (timeout ${timeoutMs}ms)`,
    );
  });
}

async function waitViaPolling({
  db,
  trackVersionId,
  timeoutMs,
  pollMs,
  logger,
  sleepFn,
}) {
  const deadline = Date.now() + timeoutMs;
  let logged = false;
  let currentPoll = pollMs;
  // Cap exponential growth so a 60s wait still produces ~6-8 polls (not 60).
  const maxPoll = Math.max(pollMs, Math.min(timeoutMs / 6, 10_000));

  while (Date.now() < deadline) {
    let ready;
    try {
      ready = await checkArtworkReady(db, trackVersionId, logger);
    } catch (err) {
      logger.warn(
        `[ArtworkBarrier] Query failed for ${trackVersionId}: ${err.message}. ` +
          `Releasing audio without artwork.`,
      );
      return false;
    }
    if (ready) return true;
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

async function checkArtworkReady(db, trackVersionId, logger) {
  try {
    const row = await db.prepare(SQL_CHECK_ARTWORK_READY).get(trackVersionId);
    return !!(row && rowIsTrue(row.artwork_ready));
  } catch (err) {
    if (logger) {
      logger.warn(`[ArtworkBarrier] check query failed: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Broadcast that artwork became ready for a specific track_version_id.
 * On PG this issues `SELECT pg_notify('artwork_ready', $1)` so any
 * `waitForArtworkReady` listener in any process picks it up immediately.
 * On SQLite this is a no-op — the polling path will catch the row update
 * on its next tick.
 *
 * Best-effort: failures are logged but do not propagate, because the
 * underlying `artwork_ready` row update is the source of truth.
 */
async function notifyArtworkReady({ db, trackVersionId, logger = console }) {
  if (!db || !trackVersionId) return;
  if (!db.isPostgres) return;
  try {
    await db
      .prepare("SELECT pg_notify('artwork_ready', ?) AS notified")
      .get(String(trackVersionId));
  } catch (err) {
    logger.warn(
      `[ArtworkBarrier] pg_notify failed for ${trackVersionId}: ${err.message}. ` +
        `Polling fallback will still catch the row update.`,
    );
  }
}

function rowIsTrue(v) {
  // PG returns boolean true; SQLite returns integer 1
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exposed for tests — resets the singleton listener state between cases.
function _resetListenerForTests() {
  if (listenerClient) {
    try {
      listenerClient.release();
    } catch {
      // ignore
    }
  }
  listenerClient = null;
  listenerSetup = null;
  localBus.removeAllListeners();
}

module.exports = {
  waitForArtworkReady,
  notifyArtworkReady,
  ARTWORK_BARRIER_TIMEOUT_MS,
  ARTWORK_BARRIER_POLL_MS,
  SQL_CHECK_ARTWORK_READY,
  _resetListenerForTests,
};
