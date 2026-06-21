"use strict";

const crypto = require("crypto");
const { newUuid, newShareId } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const { dbGet, dbRun } = require("../utils/db-adapter");
const { computeFollowupSchedule } = require("./share-followup-service");

const LIFETIME_SHARE_EXPIRES_AT = "9999-12-31T23:59:59.000Z";

function isLifetimeShare(share) {
  return share?.share_type === "lifetime";
}

function isDemoShare(share) {
  return share?.share_type === "demo";
}

function isShareUsable(share) {
  if (!share || share.status === "revoked") {
    return false;
  }
  if (isLifetimeShare(share) || isDemoShare(share)) {
    return true;
  }
  return new Date(share.expires_at) > new Date();
}

/**
 * Auto-heal a lifetime share that was incorrectly stamped "expired" by old code,
 * then check if the share is usable. Mutates `share.status` in-place if healed.
 * @returns {boolean} true if the share is usable
 */
async function healAndCheckShare(db, share, table, activeStatus) {
  if (share.status === "expired" && isLifetimeShare(share)) {
    const isBound = share.bound_device_id || share.bound_user_id;
    share.status = isBound ? "claimed" : activeStatus;
    await dbRun(db, `UPDATE ${table} SET status = ? WHERE id = ?`, [
      share.status,
      share.id,
    ]);
  }
  if (!isShareUsable(share)) {
    if (share.status !== "expired") {
      await dbRun(db, `UPDATE ${table} SET status = ? WHERE id = ?`, [
        "expired",
        share.id,
      ]);
    }
    return false;
  }
  return true;
}

async function upgradeToLifetime(db, share, table, activeStatus) {
  if (share.status === "revoked" || isLifetimeShare(share)) return share;
  const isBound = share.bound_device_id || share.bound_user_id;
  const nextStatus =
    share.status === "expired"
      ? isBound
        ? "claimed"
        : activeStatus
      : share.status || activeStatus;
  await dbRun(
    db,
    `UPDATE ${table} SET share_type = ?, expires_at = ?, status = ? WHERE id = ?`,
    ["lifetime", LIFETIME_SHARE_EXPIRES_AT, nextStatus, share.id],
  );
  share.share_type = "lifetime";
  share.expires_at = LIFETIME_SHARE_EXPIRES_AT;
  share.status = nextStatus;
  return share;
}

/**
 * Create or return an existing share token for a track.
 *
 * Idempotent: if a valid (non-expired, non-revoked) token already exists,
 * returns it with `existing: true`. Safe to call multiple times.
 *
 * @param {Object} options
 * @param {Object} options.db - Database adapter (prepare/run/get interface)
 * @param {string} options.trackId
 * @param {string} options.trackVersionId
 * @param {string} options.userId - Creator user ID
 * @param {Function} options.buildShareUrl - (shareId) => full URL
 * @param {Function} [options.ensureShareMp4] - Optional mp4 pre-generation
 * @param {Object} [options.attribution] - UTM/referrer/IP/UA for analytics
 * @returns {Promise<{shareId, shareUrl, claimPin, expiresAt, existing}>}
 */
async function createOrGetShareToken({
  db,
  trackId,
  trackVersionId,
  userId,
  buildShareUrl,
  ensureShareMp4,
  attribution = {},
  requirePin = true,
}) {
  // Check for existing valid token (idempotent)
  const track = await dbGet(
    db,
    "SELECT share_token_id FROM tracks WHERE id = ?",
    [trackId],
  );
  if (track?.share_token_id) {
    const existing = await dbGet(
      db,
      "SELECT * FROM share_tokens WHERE id = ?",
      [track.share_token_id],
    );
    if (existing && existing.status !== "revoked") {
      if (!isLifetimeShare(existing) && !isDemoShare(existing)) {
        await upgradeToLifetime(db, existing, "share_tokens", "unbound");
      }
      if (isShareUsable(existing)) {
        // Strip the PIN on reuse when the caller opted into a PIN-less share.
        // A returning user's old PINned token would otherwise leak a PIN into
        // the one-tap message. NULL it out before handing the token back.
        if (requirePin === false && existing.claim_pin != null) {
          await dbRun(
            db,
            "UPDATE share_tokens SET claim_pin = NULL, claim_attempts = 0 WHERE id = ?",
            [existing.id],
          );
          existing.claim_pin = null;
        }
        return {
          shareId: existing.id,
          shareUrl: buildShareUrl(existing.id),
          claimPin: existing.claim_pin,
          expiresAt: existing.expires_at,
          existing: true,
        };
      }
    }
  }

  const shareId = newShareId();
  const expiresAt = LIFETIME_SHARE_EXPIRES_AT;
  const streamKeyId = newUuid();
  const streamKey = crypto.randomBytes(16).toString("base64");
  const claimPin = requirePin
    ? String(crypto.randomInt(100000, 1000000))
    : null;

  // Handle UNIQUE constraint: delete expired token for this track if one exists
  await dbRun(
    db,
    "DELETE FROM share_tokens WHERE track_id = ? AND status IN ('expired', 'revoked')",
    [trackId],
  );

  await dbRun(
    db,
    "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, bound_device_id, bound_device_platform, bound_app_version, bound_at, web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count, stream_key_id, stream_key, claim_pin, claim_attempts, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      shareId,
      trackId,
      trackVersionId,
      userId,
      "unbound",
      "lifetime",
      null,
      null,
      null,
      null,
      1,
      1,
      expiresAt,
      nowIso(),
      null,
      0,
      streamKeyId,
      streamKey,
      claimPin,
      0,
      attribution.utmSource || null,
      attribution.utmMedium || null,
      attribution.utmCampaign || null,
      attribution.referrer || null,
      attribution.ip || null,
      attribution.userAgent || null,
    ],
  );

  await dbRun(
    db,
    "UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?",
    [shareId, nowIso(), trackId],
  );

  // Schedule sender re-engagement / rating-ask follow-up emails.
  // Non-fatal: a scheduling failure must never block the share itself.
  try {
    await scheduleShareFollowups(db, shareId, userId);
  } catch (err) {
    console.warn(
      `[ShareService] follow-up scheduling failed (non-fatal):`,
      err?.message,
    );
  }

  // Pre-generate share.mp4 for social crawlers (non-fatal, optional)
  if (ensureShareMp4) {
    try {
      await ensureShareMp4();
    } catch (err) {
      console.warn(
        `[ShareService] Share mp4 pre-generation failed (non-fatal):`,
        err?.message,
      );
    }
  }

  return {
    shareId,
    shareUrl: buildShareUrl(shareId),
    claimPin,
    expiresAt,
    existing: false,
  };
}

async function ensurePoemShareToken({
  db,
  poemId,
  userId,
  allowSave = true,
  buildShareUrl,
  attribution = {},
}) {
  const poem = await dbGet(
    db,
    "SELECT share_token_id FROM poems WHERE id = ?",
    [poemId],
  );
  if (poem?.share_token_id) {
    const existing = await dbGet(
      db,
      "SELECT * FROM poem_share_tokens WHERE id = ?",
      [poem.share_token_id],
    );
    if (existing && existing.status !== "revoked") {
      if (!isLifetimeShare(existing) && !isDemoShare(existing)) {
        await upgradeToLifetime(db, existing, "poem_share_tokens", "active");
      }
      if (isShareUsable(existing)) {
        return {
          shareId: existing.id,
          shareUrl: buildShareUrl(existing.id),
          claimPin: existing.claim_pin,
          expiresAt: existing.expires_at,
          existing: true,
        };
      }
    }
  }

  const shareId = newShareId();
  const claimPin = String(crypto.randomInt(100000, 1000000));

  await dbRun(
    db,
    "DELETE FROM poem_share_tokens WHERE poem_id = ? AND status IN ('expired', 'revoked')",
    [poemId],
  );

  await dbRun(
    db,
    `INSERT INTO poem_share_tokens (
      id, poem_id, creator_id, status, share_type, claim_pin, claim_attempts, allow_save, expires_at,
      created_at, access_count, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      shareId,
      poemId,
      userId,
      "active",
      "lifetime",
      claimPin,
      0,
      allowSave ? 1 : 0,
      LIFETIME_SHARE_EXPIRES_AT,
      nowIso(),
      0,
      attribution.utmSource || null,
      attribution.utmMedium || null,
      attribution.utmCampaign || null,
      attribution.referrer || null,
      attribution.ip || null,
      attribution.userAgent || null,
    ],
  );

  await dbRun(
    db,
    "UPDATE poems SET share_token_id = ?, updated_at = ? WHERE id = ?",
    [shareId, nowIso(), poemId],
  );

  return {
    shareId,
    shareUrl: buildShareUrl(shareId),
    claimPin,
    expiresAt: LIFETIME_SHARE_EXPIRES_AT,
    existing: false,
  };
}

/**
 * Insert the 3-stage share-followup schedule for a freshly created share.
 * Uses ON CONFLICT DO NOTHING so re-running for an already-scheduled share
 * is a safe no-op (idempotent via the UNIQUE(share_token_id, stage)
 * constraint).
 */
async function scheduleShareFollowups(db, shareTokenId, senderUserId) {
  const scheduled = computeFollowupSchedule(new Date());
  for (const entry of scheduled) {
    await dbRun(
      db,
      `INSERT INTO share_followups (id, share_token_id, sender_user_id, stage, send_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (share_token_id, stage) DO NOTHING`,
      [
        newUuid(),
        shareTokenId,
        senderUserId,
        entry.stage,
        entry.sendAt.toISOString(),
      ],
    );
  }
}

module.exports = {
  LIFETIME_SHARE_EXPIRES_AT,
  isLifetimeShare,
  isShareUsable,
  healAndCheckShare,
  createOrGetShareToken,
  ensurePoemShareToken,
  scheduleShareFollowups,
};
