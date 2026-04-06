"use strict";

const crypto = require("crypto");
const { newUuid, newShareId } = require("../utils/ids");
const { nowIso } = require("../utils/common");

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
 * @param {number} [options.expiresInDays=30]
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
  expiresInDays = 30,
  buildShareUrl,
  ensureShareMp4,
  attribution = {},
}) {
  // Check for existing valid token (idempotent)
  const track = await db.prepare("SELECT share_token_id FROM tracks WHERE id = ?").get(trackId);
  if (track?.share_token_id) {
    const existing = await db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(track.share_token_id);
    if (existing && existing.status !== "revoked") {
      const isDemo = existing.share_type === "demo";
      const isValid = isDemo || new Date(existing.expires_at) > new Date();
      if (isValid) {
        return {
          shareId: existing.id,
          shareUrl: buildShareUrl(existing.id),
          claimPin: existing.claim_pin,
          expiresAt: existing.expires_at,
          existing: true,
        };
      }
      // Expired — mark it
      if (!isDemo && existing.status !== "expired") {
        await db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", existing.id);
      }
    }
  }

  const shareId = newShareId();
  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const streamKeyId = newUuid();
  const streamKey = crypto.randomBytes(16).toString("base64");
  const claimPin = String(crypto.randomInt(100000, 1000000));

  // Handle UNIQUE constraint: delete expired token for this track if one exists
  await db.prepare(
    "DELETE FROM share_tokens WHERE track_id = ? AND status IN ('expired', 'revoked')"
  ).run(trackId);

  await db.prepare(
    "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, bound_device_id, bound_device_platform, bound_app_version, bound_at, web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count, stream_key_id, stream_key, claim_pin, claim_attempts, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    shareId,
    trackId,
    trackVersionId,
    userId,
    "unbound",
    null, null, null, null, // device binding
    1, 1, // web_stream_allowed, app_save_allowed
    expiresAt,
    nowIso(),
    null, 0, // last_accessed_at, access_count
    streamKeyId, streamKey, claimPin, 0, // stream key + PIN
    attribution.utmSource || null,
    attribution.utmMedium || null,
    attribution.utmCampaign || null,
    attribution.referrer || null,
    attribution.ip || null,
    attribution.userAgent || null
  );

  await db.prepare("UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?")
    .run(shareId, nowIso(), trackId);

  // Pre-generate share.mp4 for social crawlers (non-fatal, optional)
  if (ensureShareMp4) {
    try {
      await ensureShareMp4();
    } catch (err) {
      console.warn(`[ShareService] Share mp4 pre-generation failed (non-fatal):`, err?.message);
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

module.exports = { createOrGetShareToken };
