const { generateSongArtwork } = require("../services/song-artwork");
const { extractArtworkVars } = require("../services/artwork-vars-extractor");
const {
  getDefault: getArtworkVarsDefault,
} = require("../services/artwork-vocab");
const { notifyArtworkReady } = require("../workflows/artwork-barrier");
const { newUuid } = require("../utils/ids");

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 15_000, 45_000]; // matches existing API retry policy
const STALE_RUNNING_MS = 5 * 60 * 1000; // a row stuck in 'running' for 5min is dead

const SQL_GET_TRACK = `
  SELECT
    t.id, t.user_id, t.occasion, t.recipient_name, t.style,
    t.artwork_content_hash, t.latest_version,
    u.display_name AS sender_display_name
  FROM tracks t
  LEFT JOIN users u ON u.id = t.user_id
  WHERE t.id = ?
`;

const SQL_GET_LATEST_VERSION = `
  SELECT id FROM track_versions
  WHERE track_id = ?
  ORDER BY version_num DESC
  LIMIT 1
`;

const SQL_GET_VERSION_LYRICS = `
  SELECT lyrics_json FROM track_versions
  WHERE id = ?
`;

const SQL_GET_ENTITLEMENT = `
  SELECT tier, admin_upgrade_tier, admin_upgrade_expires_at
  FROM entitlements
  WHERE user_id = ?
`;

const SQL_UPDATE_ARTWORK = `
  UPDATE tracks SET
    artwork_url = ?,
    artwork_style_variant = ?,
    artwork_source = ?,
    artwork_provider = ?,
    artwork_prompt = ?,
    artwork_content_hash = ?,
    artwork_moderation_passed = ?,
    artwork_generated_at = ?
  WHERE id = ?
`;

// Persists the picked vars + provenance to the per-version row. Lives on
// track_versions (not tracks) so preview and full each carry their own
// extractor output — see migration 113.
const SQL_UPDATE_ARTWORK_VARS = `
  UPDATE track_versions SET
    artwork_vars_json = ?,
    artwork_provider = ?,
    artwork_prompt_version = ?
  WHERE id = ?
`;

// Scoped to track_version row, not track — preview and full each need their
// own flag so the barrier doesn't return instantly with stale artwork.
const SQL_MARK_ARTWORK_READY = `
  UPDATE track_versions SET artwork_ready = ?
  WHERE id = ?
`;

// Durable-queue SQL — artwork jobs live in the shared `jobs` table.
// The audio runner's claim query MUST exclude workflow_type='artwork_render'
// (see src/workflows/runner.js) so the audio pipeline doesn't try to step
// through artwork rows.
const SQL_INSERT_ARTWORK_JOB = `
  INSERT INTO jobs (
    id, track_version_id, workflow_type, status, step,
    attempts, max_attempts, step_index, step_data,
    progress_pct, created_at, updated_at
  ) VALUES (?, ?, 'artwork_render', 'queued', 'generate', 0, ?, 0, ?, 0, ?, ?)
`;

const SQL_MARK_JOB_RUNNING = `
  UPDATE jobs SET status = 'running', last_heartbeat_at = ?, updated_at = ?
  WHERE id = ?
`;

const SQL_MARK_JOB_COMPLETED = `
  UPDATE jobs SET status = 'completed', progress_pct = 100, completed_at = ?, updated_at = ?
  WHERE id = ?
`;

const SQL_MARK_JOB_FAILED = `
  UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?,
    completed_at = ?, updated_at = ?
  WHERE id = ?
`;

const SQL_REQUEUE_JOB = `
  UPDATE jobs SET status = 'queued', attempts = ?, next_attempt_at = ?,
    error_message = ?, updated_at = ?
  WHERE id = ?
`;

const SQL_SELECT_ORPHANED_ARTWORK_JOBS = `
  SELECT j.id, j.track_version_id, j.attempts, tv.track_id
  FROM jobs j
  LEFT JOIN track_versions tv ON tv.id = j.track_version_id
  WHERE j.workflow_type = 'artwork_render'
    AND (
      (j.status = 'queued' AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?))
      OR (j.status = 'running' AND (j.last_heartbeat_at IS NULL OR j.last_heartbeat_at < ?))
    )
  ORDER BY j.created_at ASC
`;

/**
 * Execute the artwork pipeline for one track and persist the result.
 *
 * @param {Object} args
 * @param {Object} args.db                Database wrapper (db.prepare(sql).get/run)
 * @param {string} args.trackId
 * @param {string} [args.trackVersionId]  When provided, scopes the artwork_ready
 *                                        flag to this version. Otherwise resolved
 *                                        to the latest version from track_versions.
 * @param {string} [args.jobId]           When provided, persist job status transitions
 *                                        ('running' → 'completed'/'failed') in the
 *                                        `jobs` table for durability across restarts.
 * @param {number} [args.attempt]         1-indexed retry counter
 * @param {Object} [args.logger]
 * @param {Function} [args.generateFn]    Override for tests (defaults to generateSongArtwork)
 * @param {Function} [args.tierResolver]  async (userId) → 'free' | 'plus' | 'pro'
 * @param {Object}   [args.generateDependencies] Forwarded to generateSongArtwork.dependencies
 */
async function runArtworkJob({
  db,
  trackId,
  trackVersionId,
  jobId,
  attempt = 1,
  logger = console,
  generateFn = generateSongArtwork,
  extractVarsFn = extractArtworkVars,
  tierResolver,
  generateDependencies = {},
}) {
  if (!db || !trackId) {
    throw new Error("runArtworkJob requires db and trackId");
  }

  // Periodic heartbeat: a paid-tier OpenAI call can take >100s, well under
  // STALE_RUNNING_MS (5min) but enough that a slow downstream + a slow DB
  // could brush the threshold. Pulse every 30s so the orphan sweep doesn't
  // start a duplicate run mid-flight.
  let heartbeatTimer = null;
  if (jobId) {
    await safeJobUpdate(
      db,
      SQL_MARK_JOB_RUNNING,
      [nowIso(), nowIso(), jobId],
      logger,
    );
    heartbeatTimer = setInterval(() => {
      safeJobUpdate(
        db,
        SQL_MARK_JOB_RUNNING,
        [nowIso(), nowIso(), jobId],
        logger,
      ).catch(() => {});
    }, 30_000);
    // Don't keep the process alive solely for this timer.
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  }
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  try {
    return await runArtworkJobInner({
      db,
      trackId,
      trackVersionId,
      jobId,
      attempt,
      logger,
      generateFn,
      extractVarsFn,
      tierResolver,
      generateDependencies,
    });
  } finally {
    stopHeartbeat();
  }
}

async function runArtworkJobInner({
  db,
  trackId,
  trackVersionId,
  jobId,
  attempt,
  logger,
  generateFn,
  extractVarsFn,
  tierResolver,
  generateDependencies,
}) {
  let track;
  try {
    track = await db.prepare(SQL_GET_TRACK).get(trackId);
  } catch (err) {
    logger.error(
      `[ArtworkJob] Failed to read track ${trackId}: ${err.message}`,
    );
    if (jobId) await failJob(db, jobId, "DB_READ_ERROR", err.message, logger);
    return { ok: false, error: err };
  }
  if (!track) {
    const err = new Error(`Track not found: ${trackId}`);
    if (jobId) await failJob(db, jobId, "TRACK_NOT_FOUND", err.message, logger);
    return { ok: false, error: err };
  }

  let versionId = trackVersionId;
  if (!versionId) {
    try {
      const row = await db.prepare(SQL_GET_LATEST_VERSION).get(trackId);
      versionId = row && row.id;
    } catch (err) {
      logger.warn(
        `[ArtworkJob] track_versions lookup failed for ${trackId}: ${err.message}`,
      );
    }
  }

  let tier;
  try {
    if (typeof tierResolver === "function") {
      tier = await tierResolver(track.user_id);
    } else {
      const entitlement = await db
        .prepare(SQL_GET_ENTITLEMENT)
        .get(track.user_id);
      tier = effectiveTierFromRow(entitlement);
    }
  } catch (err) {
    // Don't silently demote — a transient DB hiccup shouldn't downgrade paying
    // users to library art. Treat tier-lookup failure as retryable.
    logger.warn(
      `[ArtworkJob] entitlements lookup failed for user ${track.user_id}: ${err.message}`,
    );
    return scheduleRetry({
      db,
      trackId,
      versionId,
      jobId,
      attempt,
      err,
      logger,
      generateFn,
      extractVarsFn,
      generateDependencies,
      tierResolver,
    });
  }

  // Lyrics → bounded-vocab vars must run BEFORE generateFn so paid renders
  // get the Haiku-picked artwork variables instead of occasion defaults.
  // Extraction is best-effort: any failure collapses to the occasion default
  // so a flaky Haiku call never blocks the render.
  const artworkVars = await resolveArtworkVars({
    db,
    trackId,
    versionId,
    occasion: track.occasion,
    extractVarsFn,
    logger,
  });

  try {
    const result = await generateFn({
      userId: track.user_id,
      trackId: track.id,
      occasion: track.occasion,
      recipientName: track.recipient_name,
      senderName: track.sender_display_name || null,
      tier: tier || "free",
      artworkVars,
      previousContentHash: track.artwork_content_hash || null,
      dependencies: generateDependencies,
    });

    if (result.skipped) {
      logger.info(
        `[ArtworkJob] Track ${trackId} unchanged (content_hash match) — skipped.`,
      );
      if (versionId) {
        await persistArtworkVars(db, versionId, result, artworkVars, logger);
        await markArtworkReady(db, versionId, true, logger);
      }
      if (jobId) await completeJob(db, jobId, logger);
      return { ok: true, skipped: true, result };
    }

    await persistArtwork(db, trackId, result);
    if (versionId) {
      await persistArtworkVars(db, versionId, result, artworkVars, logger);
      await markArtworkReady(db, versionId, true, logger);
    }
    if (jobId) await completeJob(db, jobId, logger);

    logger.info(
      `[ArtworkJob] Track ${trackId} artwork ready ` +
        `(source=${result.source}, provider=${result.provider || "n/a"}, ` +
        `species=${(result.artworkVars && result.artworkVars.species) || artworkVars.species})`,
    );
    return { ok: true, result };
  } catch (err) {
    // Permanent errors (e.g. LIBRARY_NOT_BOOTSTRAPPED) skip the retry chain —
    // burning 65s of backoff on a config error helps nobody.
    if (err && err.permanent) {
      logger.error(
        `[ArtworkJob] Track ${trackId} hit permanent error ${err.code || ""}: ${err.message}. ` +
          `Not retrying.`,
      );
      if (jobId) {
        await failJob(
          db,
          jobId,
          err.code || "PERMANENT_ERROR",
          err.message,
          logger,
        );
      }
      return { ok: false, error: err, permanent: true };
    }
    return scheduleRetry({
      db,
      trackId,
      versionId,
      jobId,
      attempt,
      err,
      logger,
      generateFn,
      extractVarsFn,
      generateDependencies,
      tierResolver,
    });
  }
}

async function scheduleRetry({
  db,
  trackId,
  versionId,
  jobId,
  attempt,
  err,
  logger,
  generateFn,
  extractVarsFn,
  generateDependencies,
  tierResolver,
}) {
  logger.warn(
    `[ArtworkJob] Track ${trackId} attempt ${attempt} failed: ${err.message}`,
  );

  if (attempt < MAX_ATTEMPTS) {
    const backoff = BACKOFF_MS[attempt - 1] || 45_000;
    logger.info(
      `[ArtworkJob] Retrying track ${trackId} in ${backoff}ms ` +
        `(attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
    );
    // Persist next_attempt_at so a process restart between sleep and retry
    // doesn't lose the work — the orphan recovery sweep will pick it up.
    if (jobId) {
      const next = new Date(Date.now() + backoff).toISOString();
      await safeJobUpdate(
        db,
        SQL_REQUEUE_JOB,
        [attempt, next, err.message, nowIso(), jobId],
        logger,
      );
    }
    await sleep(backoff);
    return runArtworkJob({
      db,
      trackId,
      trackVersionId: versionId,
      jobId,
      attempt: attempt + 1,
      logger,
      generateFn,
      extractVarsFn,
      generateDependencies,
      tierResolver,
    });
  }

  logger.error(
    `[ArtworkJob] Track ${trackId} failed after ${MAX_ATTEMPTS} attempts.`,
  );
  if (jobId) {
    await failJob(
      db,
      jobId,
      err.code || "MAX_RETRIES_EXCEEDED",
      err.message,
      logger,
    );
  }
  return { ok: false, error: err };
}

function effectiveTierFromRow(entitlement) {
  if (!entitlement) return "free";
  // Admin override takes priority when present and not expired.
  if (entitlement.admin_upgrade_tier) {
    const expiry = entitlement.admin_upgrade_expires_at
      ? new Date(entitlement.admin_upgrade_expires_at).getTime()
      : Infinity;
    if (!Number.isFinite(expiry) || expiry > Date.now()) {
      return entitlement.admin_upgrade_tier;
    }
  }
  return entitlement.tier || "free";
}

async function persistArtwork(db, trackId, result) {
  const moderationFlag = boolToDbValue(result.moderationPassed);
  // artwork_style_variant column lives on `tracks` (migration 109) but the
  // post-Task-7 generate shape no longer emits styleVariant — vars+provenance
  // are now per-version in artwork_vars_json. Keep the column slot, write null.
  await db
    .prepare(SQL_UPDATE_ARTWORK)
    .run(
      result.artworkUrl,
      null,
      result.source,
      result.provider,
      result.prompt,
      result.contentHash,
      moderationFlag,
      toIsoString(result.generatedAt),
      trackId,
    );
}

async function persistArtworkVars(
  db,
  trackVersionId,
  result,
  fallbackVars,
  logger,
) {
  if (!trackVersionId) return;
  const vars = (result && result.artworkVars) || fallbackVars || null;
  const provider = (result && result.provider) || null;
  const promptVersion = (result && result.promptVersion) || null;
  try {
    await db
      .prepare(SQL_UPDATE_ARTWORK_VARS)
      .run(
        vars ? JSON.stringify(vars) : null,
        provider,
        promptVersion,
        trackVersionId,
      );
  } catch (err) {
    // The vars columns are new (migration 113). Test schemas may not have
    // them — fail-soft, matching how the job already treats jobs-row
    // updates. The core artwork URL was already persisted above.
    (logger || console).warn(
      `[ArtworkJob] Failed to persist artwork vars on track_version ${trackVersionId}: ${err.message}`,
    );
  }
}

async function resolveArtworkVars({
  db,
  trackId,
  versionId,
  occasion,
  extractVarsFn,
  logger,
}) {
  const fallback = () => ({
    ...getArtworkVarsDefault(occasion),
    picked_by: "fallback_extractor_error",
    picked_at: new Date().toISOString(),
  });
  if (typeof extractVarsFn !== "function") return fallback();
  try {
    let lyrics = "";
    if (versionId) {
      const row = await db.prepare(SQL_GET_VERSION_LYRICS).get(versionId);
      const lyricsJson = row && row.lyrics_json;
      if (lyricsJson) {
        try {
          const parsed =
            typeof lyricsJson === "string"
              ? JSON.parse(lyricsJson)
              : lyricsJson;
          // Shape produced by buildLyrics/writeSongFromContext:
          //   { title, style, sections: [{ name, lines: [...] }], anchor_line }
          // Fall back to legacy/alternate shapes (.text, .lyrics) for safety,
          // then to the sections flatten, then to a JSON dump as last resort.
          if (typeof parsed.text === "string" && parsed.text.trim()) {
            lyrics = parsed.text;
          } else if (
            typeof parsed.lyrics === "string" &&
            parsed.lyrics.trim()
          ) {
            lyrics = parsed.lyrics;
          } else if (Array.isArray(parsed.sections)) {
            lyrics = parsed.sections
              .flatMap((s) => (Array.isArray(s.lines) ? s.lines : []))
              .join("\n");
          } else {
            lyrics = JSON.stringify(parsed);
          }
        } catch {
          lyrics = String(lyricsJson);
        }
      }
    }
    return await extractVarsFn({ lyrics, occasion, logger });
  } catch (err) {
    (logger || console).warn(
      `[artwork-job] vars extraction failed for track ${trackId}: ${err.message}; using occasion defaults`,
    );
    return fallback();
  }
}

async function markArtworkReady(db, trackVersionId, ready, logger) {
  if (!trackVersionId) return;
  await db
    .prepare(SQL_MARK_ARTWORK_READY)
    .run(boolToDbValue(ready), trackVersionId);
  if (ready) {
    // pg_notify on PG so any waiting barrier wakes immediately. No-op on SQLite.
    await notifyArtworkReady({ db, trackVersionId, logger });
  }
}

async function completeJob(db, jobId, logger) {
  const now = nowIso();
  await safeJobUpdate(db, SQL_MARK_JOB_COMPLETED, [now, now, jobId], logger);
}

async function failJob(db, jobId, code, message, logger) {
  const now = nowIso();
  await safeJobUpdate(
    db,
    SQL_MARK_JOB_FAILED,
    [code || null, message || null, now, now, jobId],
    logger,
  );
}

async function safeJobUpdate(db, sql, args, logger) {
  try {
    await db.prepare(sql).run(...args);
  } catch (err) {
    // Job-row updates failing must NOT crash the artwork pipeline — the
    // artwork itself is independently persisted via SQL_UPDATE_ARTWORK.
    (logger || console).warn(
      `[ArtworkJob] Job-row update failed: ${err.message}. Artwork state unaffected.`,
    );
  }
}

/**
 * Enqueue an artwork job durably: write a row to the shared `jobs` table
 * (so a process restart can recover it via `recoverOrphanedArtworkJobs`),
 * then fire-and-forget the in-process execution.
 */
function enqueueArtworkJob({
  db,
  trackId,
  trackVersionId,
  logger = console,
  tierResolver,
  extractVarsFn,
  generateDependencies,
}) {
  if (!db || !trackId || !trackVersionId) {
    (logger || console).warn(
      `[ArtworkJob] enqueueArtworkJob: missing required args (trackId=${trackId}, trackVersionId=${trackVersionId})`,
    );
    return;
  }
  const jobId = newUuid();
  // Best-effort jobs-row insert. The insert is wrapped in a microtask so its
  // success/failure resolves BEFORE the setImmediate fires — that lets us
  // null out the jobId on failure so we don't spawn an orphan run that
  // forever fails to update a non-existent jobs row (and that the orphan-
  // recovery sweep would never re-find).
  const stepData = JSON.stringify({ trackId });
  let effectiveJobId = jobId;
  Promise.resolve()
    .then(() =>
      db
        .prepare(SQL_INSERT_ARTWORK_JOB)
        .run(jobId, trackVersionId, 3, stepData, nowIso(), nowIso()),
    )
    .catch((err) => {
      // Sync .run throws (sql.js test path) and async insert failures both
      // land here. Null out the jobId so runArtworkJob's safeJobUpdate skips
      // the missing-row UPDATE silently instead of repeatedly warning.
      effectiveJobId = null;
      (logger || console).warn(
        `[ArtworkJob] enqueue insert failed: ${err.message}. Continuing in-process without jobs-row tracking.`,
      );
    });
  setImmediate(() => {
    runArtworkJob({
      db,
      trackId,
      trackVersionId,
      jobId: effectiveJobId,
      logger,
      tierResolver,
      extractVarsFn,
      generateDependencies,
    }).catch((err) => {
      logger.error(
        `[ArtworkJob] Unhandled error on track ${trackId}: ${err.stack || err.message}`,
      );
    });
  });
}

/**
 * Recover artwork jobs that didn't complete in their original process —
 * rows still 'queued' past their next_attempt_at, or 'running' without a
 * heartbeat for STALE_RUNNING_MS. Re-fires `runArtworkJob` for each.
 *
 * Call once at runner startup and periodically (every ~60s) to keep the
 * tail latency tight after a redeploy.
 */
async function recoverOrphanedArtworkJobs({
  db,
  logger = console,
  tierResolver,
  extractVarsFn,
  generateDependencies,
} = {}) {
  if (!db) {
    throw new Error("recoverOrphanedArtworkJobs requires db");
  }
  const now = nowIso();
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  let rows = [];
  try {
    rows = await db
      .prepare(SQL_SELECT_ORPHANED_ARTWORK_JOBS)
      .all(now, staleCutoff);
  } catch (err) {
    logger.warn(`[ArtworkJob] Orphan scan failed: ${err.message}`);
    return { recovered: 0 };
  }
  if (!rows || rows.length === 0) {
    return { recovered: 0 };
  }

  logger.info(`[ArtworkJob] Recovering ${rows.length} orphaned artwork jobs.`);
  for (const row of rows) {
    if (!row.track_id) {
      logger.warn(
        `[ArtworkJob] Orphan job ${row.id} has no parent track — failing.`,
      );
      await failJob(
        db,
        row.id,
        "ORPHAN_NO_TRACK",
        "track_version missing",
        logger,
      );
      continue;
    }
    setImmediate(() => {
      runArtworkJob({
        db,
        trackId: row.track_id,
        trackVersionId: row.track_version_id,
        jobId: row.id,
        attempt: Math.min((row.attempts || 0) + 1, MAX_ATTEMPTS),
        logger,
        tierResolver,
        extractVarsFn,
        generateDependencies,
      }).catch((err) => {
        logger.error(
          `[ArtworkJob] Recovery run failed for job ${row.id}: ${err.message}`,
        );
      });
    });
  }
  return { recovered: rows.length };
}

// ---- helpers ----

function nowIso() {
  return new Date().toISOString();
}

function boolToDbValue(v) {
  if (v === null || v === undefined) return null;
  // Both `true` and `1` round-trip cleanly through PG bool and SQLite integer.
  return v ? 1 : 0;
}

function toIsoString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return String(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  runArtworkJob,
  enqueueArtworkJob,
  recoverOrphanedArtworkJobs,
  effectiveTierFromRow,
  MAX_ATTEMPTS,
  BACKOFF_MS,
  STALE_RUNNING_MS,
  // Exposed for tests
  SQL_GET_TRACK,
  SQL_GET_LATEST_VERSION,
  SQL_GET_VERSION_LYRICS,
  SQL_GET_ENTITLEMENT,
  SQL_UPDATE_ARTWORK,
  SQL_UPDATE_ARTWORK_VARS,
  SQL_MARK_ARTWORK_READY,
  SQL_INSERT_ARTWORK_JOB,
  SQL_MARK_JOB_RUNNING,
  SQL_MARK_JOB_COMPLETED,
  SQL_MARK_JOB_FAILED,
  SQL_REQUEUE_JOB,
  SQL_SELECT_ORPHANED_ARTWORK_JOBS,
};
