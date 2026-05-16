const { generateSongArtwork } = require("../services/song-artwork");

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 15_000, 45_000]; // matches existing API retry policy

const SQL_GET_TRACK = `
  SELECT id, user_id, occasion, recipient_name, style, artwork_content_hash, latest_version
  FROM tracks
  WHERE id = ?
`;

const SQL_GET_LATEST_VERSION = `
  SELECT id FROM track_versions
  WHERE track_id = ?
  ORDER BY version_num DESC
  LIMIT 1
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

// Scoped to track_version row, not track — preview and full each need their
// own flag so the barrier doesn't return instantly with stale artwork.
const SQL_MARK_ARTWORK_READY = `
  UPDATE track_versions SET artwork_ready = ?
  WHERE id = ?
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
 * @param {number} [args.attempt]         1-indexed retry counter
 * @param {Object} [args.logger]
 * @param {Function} [args.generateFn]    Override for tests (defaults to generateSongArtwork)
 * @param {Function} [args.tierResolver]  async (userId) → 'free' | 'plus' | 'pro'
 *                                        Inject subscriptionManager.getEffectiveTier here
 *                                        in production to honor expiries + admin_upgrade.
 * @param {Object}   [args.generateDependencies] Forwarded to generateSongArtwork.dependencies
 *                                        (e.g. storageProvider for S3 upload).
 */
async function runArtworkJob({
  db,
  trackId,
  trackVersionId,
  attempt = 1,
  logger = console,
  generateFn = generateSongArtwork,
  tierResolver,
  generateDependencies = {},
}) {
  if (!db || !trackId) {
    throw new Error("runArtworkJob requires db and trackId");
  }

  let track;
  try {
    track = await db.prepare(SQL_GET_TRACK).get(trackId);
  } catch (err) {
    logger.error(
      `[ArtworkJob] Failed to read track ${trackId}: ${err.message}`,
    );
    return { ok: false, error: err };
  }
  if (!track) {
    return { ok: false, error: new Error(`Track not found: ${trackId}`) };
  }

  // Resolve the latest track_version_id if the caller didn't supply one.
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

  // Tier resolution. Prefer the injected resolver (subscriptionManager.
  // getEffectiveTier in production) so we honor expired subs + admin_upgrade_tier.
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
      attempt,
      err,
      logger,
      generateFn,
      generateDependencies,
      tierResolver,
    });
  }

  try {
    const result = await generateFn({
      userId: track.user_id,
      trackId: track.id,
      occasion: track.occasion,
      recipientName: track.recipient_name,
      tier: tier || "free",
      previousContentHash: track.artwork_content_hash || null,
      dependencies: generateDependencies,
    });

    if (result.skipped) {
      logger.info(
        `[ArtworkJob] Track ${trackId} unchanged (content_hash match) — skipped.`,
      );
      if (versionId) await markArtworkReady(db, versionId, true);
      return { ok: true, skipped: true, result };
    }

    await persistArtwork(db, trackId, result);
    if (versionId) await markArtworkReady(db, versionId, true);

    logger.info(
      `[ArtworkJob] Track ${trackId} artwork ready ` +
        `(source=${result.source}, style=${result.styleVariant})`,
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
      return { ok: false, error: err, permanent: true };
    }
    return scheduleRetry({
      db,
      trackId,
      versionId,
      attempt,
      err,
      logger,
      generateFn,
      generateDependencies,
      tierResolver,
    });
  }
}

async function scheduleRetry({
  db,
  trackId,
  versionId,
  attempt,
  err,
  logger,
  generateFn,
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
    await sleep(backoff);
    return runArtworkJob({
      db,
      trackId,
      trackVersionId: versionId,
      attempt: attempt + 1,
      logger,
      generateFn,
      generateDependencies,
      tierResolver,
    });
  }

  logger.error(
    `[ArtworkJob] Track ${trackId} failed after ${MAX_ATTEMPTS} attempts.`,
  );
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
  await db
    .prepare(SQL_UPDATE_ARTWORK)
    .run(
      result.artworkUrl,
      result.styleVariant,
      result.source,
      result.provider,
      result.prompt,
      result.contentHash,
      moderationFlag,
      toIsoString(result.generatedAt),
      trackId,
    );
}

async function markArtworkReady(db, trackVersionId, ready) {
  if (!trackVersionId) return;
  await db
    .prepare(SQL_MARK_ARTWORK_READY)
    .run(boolToDbValue(ready), trackVersionId);
}

/**
 * Fire-and-forget invocation from the render path. Returns immediately;
 * the actual work runs on the next microtask so the caller isn't blocked.
 *
 * Note: this in-process queueing is best-effort. A process restart between
 * enqueue and execution drops the work silently — durable jobs-table queueing
 * is a deferred follow-up.
 */
function enqueueArtworkJob({
  db,
  trackId,
  trackVersionId,
  logger = console,
  tierResolver,
  generateDependencies,
}) {
  setImmediate(() => {
    runArtworkJob({
      db,
      trackId,
      trackVersionId,
      logger,
      tierResolver,
      generateDependencies,
    }).catch((err) => {
      logger.error(
        `[ArtworkJob] Unhandled error on track ${trackId}: ${err.stack || err.message}`,
      );
    });
  });
}

// ---- helpers ----

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
  effectiveTierFromRow,
  MAX_ATTEMPTS,
  BACKOFF_MS,
  // Exposed for tests
  SQL_GET_TRACK,
  SQL_GET_LATEST_VERSION,
  SQL_GET_ENTITLEMENT,
  SQL_UPDATE_ARTWORK,
  SQL_MARK_ARTWORK_READY,
};
