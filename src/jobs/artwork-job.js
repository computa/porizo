const { generateSongArtwork } = require("../services/song-artwork");
const { extractArtworkVars } = require("../services/artwork-vars-extractor");
const {
  getDefault: getArtworkVarsDefault,
} = require("../services/artwork-vocab");
const { notifyArtworkReady } = require("../workflows/artwork-barrier");
const { newUuid } = require("../utils/ids");
const {
  createArtworkJobRepository,
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
} = require("../database/artwork-job-repository");

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 15_000, 45_000]; // matches existing API retry policy
const STALE_RUNNING_MS = 5 * 60 * 1000; // a row stuck in 'running' for 5min is dead

/**
 * Execute the artwork pipeline for one track and persist the result.
 *
 * @param {Object} args
 * @param {Object} args.db                Database wrapper (db.prepare(sql).get/run)
 * @param {Object} [args.artworkJobRepository] Persistence boundary for artwork job state
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
  artworkJobRepository,
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
  const repository = artworkJobRepository || createArtworkJobRepository(db);

  // Periodic heartbeat: a paid-tier OpenAI call can take >100s, well under
  // STALE_RUNNING_MS (5min) but enough that a slow downstream + a slow DB
  // could brush the threshold. Pulse every 30s so the orphan sweep doesn't
  // start a duplicate run mid-flight.
  let heartbeatTimer = null;
  if (jobId) {
    const claimResult = await safeJobUpdate(
      () => repository.markJobRunning({ jobId, now: nowIso() }),
      logger,
    );
    if (isZeroChangeResult(claimResult)) {
      const err = new Error(`Artwork job is no longer claimable: ${jobId}`);
      logger.warn(`[ArtworkJob] ${err.message}`);
      return { ok: false, skipped: true, stale: true, error: err };
    }
    heartbeatTimer = setInterval(() => {
      safeJobUpdate(
        () => repository.markJobRunning({ jobId, now: nowIso() }),
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
      artworkJobRepository: repository,
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
  artworkJobRepository,
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
    track = await artworkJobRepository.getTrack(trackId);
  } catch (err) {
    logger.error(
      `[ArtworkJob] Failed to read track ${trackId}: ${err.message}`,
    );
    if (jobId) {
      await failJob(artworkJobRepository, jobId, "DB_READ_ERROR", err.message, logger);
    }
    return { ok: false, error: err };
  }
  if (!track) {
    const err = new Error(`Track not found: ${trackId}`);
    if (jobId) {
      await failJob(
        artworkJobRepository,
        jobId,
        "TRACK_NOT_FOUND",
        err.message,
        logger,
      );
    }
    return { ok: false, error: err };
  }

  let versionId = trackVersionId;
  if (!versionId) {
    try {
      const row = await artworkJobRepository.getLatestVersionForTrack(trackId);
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
      const entitlement = await artworkJobRepository.getEntitlement(track.user_id);
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
      artworkJobRepository,
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
    artworkJobRepository,
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
        await persistArtworkVars(
          artworkJobRepository,
          versionId,
          result,
          artworkVars,
          logger,
        );
        await markArtworkReady(db, artworkJobRepository, versionId, true, logger);
      }
      if (jobId) await completeJob(artworkJobRepository, jobId, logger);
      return { ok: true, skipped: true, result };
    }

    await persistArtwork(artworkJobRepository, trackId, result);
    if (versionId) {
      await persistArtworkVars(
        artworkJobRepository,
        versionId,
        result,
        artworkVars,
        logger,
      );
      await markArtworkReady(db, artworkJobRepository, versionId, true, logger);
    }
    if (jobId) await completeJob(artworkJobRepository, jobId, logger);

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
          artworkJobRepository,
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
      artworkJobRepository,
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
  artworkJobRepository,
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
      const requeueResult = await safeJobUpdate(
        () =>
          artworkJobRepository.requeueJob({
            jobId,
            attempts: attempt,
            nextAttemptAt: next,
            message: err.message,
            now: nowIso(),
        }),
        logger,
      );
      if (isZeroChangeResult(requeueResult)) {
        const staleErr = new Error(`Artwork job is no longer retryable: ${jobId}`);
        logger.warn(`[ArtworkJob] ${staleErr.message}`);
        return { ok: false, skipped: true, stale: true, error: staleErr };
      }
    }
    await sleep(backoff);
    return runArtworkJob({
      db,
      artworkJobRepository,
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
      artworkJobRepository,
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

async function persistArtwork(artworkJobRepository, trackId, result) {
  const moderationFlag = boolToDbValue(result.moderationPassed);
  // artwork_style_variant column lives on `tracks` (migration 109) but the
  // post-Task-7 generate shape no longer emits styleVariant — vars+provenance
  // are now per-version in artwork_vars_json. Keep the column slot, write null.
  await artworkJobRepository.updateArtwork({
    trackId,
    artworkUrl: result.artworkUrl,
    artworkStyleVariant: null,
    artworkSource: result.source,
    artworkProvider: result.provider,
    artworkPrompt: result.prompt,
    artworkContentHash: result.contentHash,
    artworkModerationPassed: moderationFlag,
    artworkGeneratedAt: toIsoString(result.generatedAt),
  });
}

async function persistArtworkVars(
  artworkJobRepository,
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
    await artworkJobRepository.updateArtworkVars({
      trackVersionId,
      artworkVarsJson: vars ? JSON.stringify(vars) : null,
      artworkProvider: provider,
      artworkPromptVersion: promptVersion,
    });
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
  artworkJobRepository,
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
      const row = await artworkJobRepository.getVersionLyrics(versionId);
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

async function markArtworkReady(
  db,
  artworkJobRepository,
  trackVersionId,
  ready,
  logger,
) {
  if (!trackVersionId) return;
  await artworkJobRepository.markArtworkReady({
    trackVersionId,
    ready: boolToDbValue(ready),
  });
  if (ready) {
    // pg_notify on PG so any waiting barrier wakes immediately. No-op on SQLite.
    await notifyArtworkReady({ db, trackVersionId, logger });
  }
}

async function completeJob(artworkJobRepository, jobId, logger) {
  const now = nowIso();
  await safeJobUpdate(
    () => artworkJobRepository.markJobCompleted({ jobId, now }),
    logger,
  );
}

async function failJob(artworkJobRepository, jobId, code, message, logger) {
  const now = nowIso();
  await safeJobUpdate(
    () => artworkJobRepository.markJobFailed({ jobId, code, message, now }),
    logger,
  );
}

async function safeJobUpdate(updateFn, logger) {
  try {
    return await updateFn();
  } catch (err) {
    // Job-row updates failing must NOT crash the artwork pipeline — the
    // artwork itself is independently persisted via SQL_UPDATE_ARTWORK.
    (logger || console).warn(
      `[ArtworkJob] Job-row update failed: ${err.message}. Artwork state unaffected.`,
    );
    return null;
  }
}

function isZeroChangeResult(result) {
  if (!result || typeof result !== "object") return false;
  const changes = result.changes ?? result.rowCount;
  return Number(changes) === 0;
}

/**
 * Enqueue an artwork job durably: write a row to the shared `jobs` table
 * (so a process restart can recover it via `recoverOrphanedArtworkJobs`),
 * then fire-and-forget the in-process execution.
 * Returns a handle so lifecycle owners can wait for graceful shutdown without
 * blocking request handlers.
 */
function enqueueArtworkJob({
  db,
  artworkJobRepository,
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
  const repository = artworkJobRepository || createArtworkJobRepository(db);
  const jobId = newUuid();
  // Best-effort jobs-row insert. The insert is wrapped in a microtask so its
  // success/failure resolves BEFORE the setImmediate fires — that lets us
  // null out the jobId on failure so we don't spawn an orphan run that
  // forever fails to update a non-existent jobs row (and that the orphan-
  // recovery sweep would never re-find).
  const stepData = JSON.stringify({ trackId });
  let effectiveJobId = jobId;
  const insertPromise = Promise.resolve()
    .then(() =>
      repository.insertArtworkJob({
        jobId,
        trackVersionId,
        maxAttempts: 3,
        stepData,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }),
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
  const promise = new Promise((resolve) => {
    setImmediate(() => {
      insertPromise
        .then(() =>
          runArtworkJob({
            db,
            artworkJobRepository: repository,
            trackId,
            trackVersionId,
            jobId: effectiveJobId,
            logger,
            tierResolver,
            extractVarsFn,
            generateDependencies,
          }),
        )
        .catch((err) => {
          logger.error(
            `[ArtworkJob] Unhandled error on track ${trackId}: ${err.stack || err.message}`,
          );
        })
        .finally(resolve);
    });
  });
  return { jobId, promise };
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
  artworkJobRepository,
  logger = console,
  tierResolver,
  extractVarsFn,
  generateDependencies,
} = {}) {
  if (!db) {
    throw new Error("recoverOrphanedArtworkJobs requires db");
  }
  const repository = artworkJobRepository || createArtworkJobRepository(db);
  const now = nowIso();
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  let rows = [];
  try {
    rows = await repository.listRecoverableJobs({ now, staleCutoff });
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
        repository,
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
        artworkJobRepository: repository,
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
