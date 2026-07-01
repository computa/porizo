"use strict";

const crypto = require("crypto");
const { newUuid, newShareId } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const { createShareFollowupRepository } = require("../database/share-followup-repository");
const {
  createShareTokenRepository,
} = require("../database/share-token-repository");
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
async function healAndCheckShare(db, share, table, activeStatus, options = {}) {
  const repository = options.repository || createShareTokenRepository(db);
  if (share.status === "expired" && isLifetimeShare(share)) {
    const isBound = share.bound_device_id || share.bound_user_id;
    share.status = isBound ? "claimed" : activeStatus;
    await repository.updateShareStatus(table, share.id, share.status);
  }
  if (!isShareUsable(share)) {
    if (share.status !== "expired") {
      await repository.updateShareStatus(table, share.id, "expired");
    }
    return false;
  }
  return true;
}

async function upgradeToLifetime(db, share, table, activeStatus, options = {}) {
  if (share.status === "revoked" || isLifetimeShare(share)) return share;
  const repository = options.repository || createShareTokenRepository(db);
  const isBound = share.bound_device_id || share.bound_user_id;
  const nextStatus =
    share.status === "expired"
      ? isBound
        ? "claimed"
        : activeStatus
      : share.status || activeStatus;
  await repository.upgradeShareToLifetime(table, share.id, {
    expiresAt: LIFETIME_SHARE_EXPIRES_AT,
    status: nextStatus,
  });
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
  repository,
}) {
  const shareTokenRepository = repository || createShareTokenRepository(db);
  // Check for existing valid token (idempotent)
  const track = await shareTokenRepository.getTrackSharePointer(trackId);
  if (track?.share_token_id) {
    const existing = await shareTokenRepository.getSongShareTokenById(
      track.share_token_id,
    );
    if (existing && existing.status !== "revoked") {
      if (!isLifetimeShare(existing) && !isDemoShare(existing)) {
        await upgradeToLifetime(db, existing, "share_tokens", "unbound", {
          repository: shareTokenRepository,
        });
      }
      if (isShareUsable(existing)) {
        // Strip the PIN on reuse when the caller opted into a PIN-less share.
        // A returning user's old PINned token would otherwise leak a PIN into
        // the one-tap message. NULL it out before handing the token back.
        // Only on unbound tokens — once claimed, device binding is the lock and
        // the PIN is already moot, so there's no reason to mutate it.
        if (
          requirePin === false &&
          existing.claim_pin != null &&
          existing.status === "unbound"
        ) {
          await shareTokenRepository.clearUnboundSongSharePin(existing.id);
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
  await shareTokenRepository.deleteExpiredOrRevokedSongShares(trackId);

  await shareTokenRepository.insertSongShareToken({
    id: shareId,
    trackId,
    trackVersionId,
    creatorId: userId,
    status: "unbound",
    shareType: "lifetime",
    boundDeviceId: null,
    boundDevicePlatform: null,
    boundAppVersion: null,
    boundAt: null,
    webStreamAllowed: true,
    appSaveAllowed: true,
    expiresAt,
    createdAt: nowIso(),
    lastAccessedAt: null,
    accessCount: 0,
    streamKeyId,
    streamKey,
    claimPin,
    claimAttempts: 0,
    utmSource: attribution.utmSource || null,
    utmMedium: attribution.utmMedium || null,
    utmCampaign: attribution.utmCampaign || null,
    referrer: attribution.referrer || null,
    createdIp: attribution.ip || null,
    createdUserAgent: attribution.userAgent || null,
  });

  await shareTokenRepository.setTrackShareToken({
    trackId,
    shareTokenId: shareId,
    updatedAt: nowIso(),
  });

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
  repository,
}) {
  const shareTokenRepository = repository || createShareTokenRepository(db);
  const poem = await shareTokenRepository.getPoemSharePointer(poemId);
  if (poem?.share_token_id) {
    const existing = await shareTokenRepository.getPoemShareTokenById(
      poem.share_token_id,
    );
    if (existing && existing.status !== "revoked") {
      if (!isLifetimeShare(existing) && !isDemoShare(existing)) {
        await upgradeToLifetime(db, existing, "poem_share_tokens", "active", {
          repository: shareTokenRepository,
        });
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

  await shareTokenRepository.deleteExpiredOrRevokedPoemShares(poemId);

  await shareTokenRepository.insertPoemShareToken({
    id: shareId,
    poemId,
    creatorId: userId,
    status: "active",
    shareType: "lifetime",
    claimPin,
    claimAttempts: 0,
    allowSave,
    expiresAt: LIFETIME_SHARE_EXPIRES_AT,
    createdAt: nowIso(),
    accessCount: 0,
    utmSource: attribution.utmSource || null,
    utmMedium: attribution.utmMedium || null,
    utmCampaign: attribution.utmCampaign || null,
    referrer: attribution.referrer || null,
    createdIp: attribution.ip || null,
    createdUserAgent: attribution.userAgent || null,
  });

  await shareTokenRepository.setPoemShareToken({
    poemId,
    shareTokenId: shareId,
    updatedAt: nowIso(),
  });

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
async function scheduleShareFollowups(
  db,
  shareTokenId,
  senderUserId,
  options = {},
) {
  const repository = options.repository || createShareFollowupRepository(db);
  const scheduled = computeFollowupSchedule(new Date());
  await repository.scheduleFollowups(
    scheduled.map((entry) => ({
      id: newUuid(),
      shareTokenId,
      senderUserId,
      stage: entry.stage,
      sendAt: entry.sendAt.toISOString(),
    })),
  );
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
