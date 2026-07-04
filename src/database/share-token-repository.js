"use strict";

const {
  createPreparedDbFromQuery,
  dbAll,
  dbGet,
  dbRun,
} = require("../utils/db-adapter");

const ALLOWED_SHARE_TABLES = new Set(["share_tokens", "poem_share_tokens"]);

function assertShareTable(table) {
  if (!ALLOWED_SHARE_TABLES.has(table)) {
    throw new Error(`Unsupported share token table: ${table}`);
  }
}

function shareTableForContentType(contentType) {
  return contentType === "poem" ? "poem_share_tokens" : "share_tokens";
}

function createShareTokenRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function getTrackSharePointer(trackId) {
    return dbGet(db, "SELECT share_token_id FROM tracks WHERE id = ?", [
      trackId,
    ]);
  }

  async function getPoemSharePointer(poemId) {
    return dbGet(db, "SELECT share_token_id FROM poems WHERE id = ?", [
      poemId,
    ]);
  }

  async function getSongShareTokenById(id) {
    return dbGet(db, "SELECT * FROM share_tokens WHERE id = ?", [id]);
  }

  async function getPoemShareTokenById(id) {
    return dbGet(db, "SELECT * FROM poem_share_tokens WHERE id = ?", [id]);
  }

  async function getTrackById(id) {
    return dbGet(db, "SELECT * FROM tracks WHERE id = ?", [id]);
  }

  async function getTrackVersionById(id) {
    return dbGet(db, "SELECT * FROM track_versions WHERE id = ?", [id]);
  }

  async function getShareTrackPair({ trackId, trackVersionId }) {
    const track = trackId ? await getTrackById(trackId) : null;
    const trackVersion = trackVersionId
      ? await getTrackVersionById(trackVersionId)
      : null;
    return { track, trackVersion };
  }

  async function getGiftOrderSendAt(giftOrderId) {
    return dbGet(db, "SELECT send_at FROM gift_orders WHERE id = ?", [
      giftOrderId,
    ]);
  }

  async function getGiftOrderSenderSummary(giftOrderId) {
    return dbGet(
      db,
      "SELECT sender_display_name, recipient_name FROM gift_orders WHERE id = ?",
      [giftOrderId],
    );
  }

  async function getUserDisplayName(userId) {
    return dbGet(db, "SELECT display_name FROM users WHERE id = ?", [userId]);
  }

  async function getTrackNotificationMetadata(trackId) {
    return dbGet(
      db,
      "SELECT title, recipient_name FROM tracks WHERE id = ?",
      [trackId],
    );
  }

  async function getPoemShareTokenWithGiftSendAt(id) {
    return dbGet(
      db,
      `SELECT pst.*, go.send_at AS gift_send_at
         FROM poem_share_tokens pst
         LEFT JOIN gift_orders go ON go.id = pst.gift_order_id
        WHERE pst.id = ?`,
      [id],
    );
  }

  async function markPoemShareAccessed({ shareTokenId, accessedAt }) {
    return dbRun(
      db,
      "UPDATE poem_share_tokens SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
      [accessedAt, shareTokenId],
    );
  }

  async function insertPoemShareAccessLog({
    id,
    shareTokenId,
    eventType,
    metadata,
    createdAt,
  }) {
    return dbRun(
      db,
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, shareTokenId, eventType, metadata, createdAt],
    );
  }

  async function incrementPoemShareClaimAttempts(shareTokenId) {
    return dbRun(
      db,
      "UPDATE poem_share_tokens SET claim_attempts = claim_attempts + 1 WHERE id = ? AND claim_attempts < 5 AND status = 'active'",
      [shareTokenId],
    );
  }

  async function claimPoemShareForUser({ shareTokenId, userId, claimedAt }) {
    return dbRun(
      db,
      "UPDATE poem_share_tokens SET status = ?, bound_user_id = ?, bound_at = ?, claim_attempts = 0 WHERE id = ?",
      ["claimed", userId, claimedAt, shareTokenId],
    );
  }

  async function addPoemShareAccessLog({
    id,
    poemShareTokenId,
    eventType,
    metadataJson,
    createdAt,
  }) {
    return dbRun(
      db,
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, poemShareTokenId, eventType, metadataJson, createdAt],
    );
  }

  async function getPoemShareForOgImage(shareTokenId) {
    return dbGet(
      db,
      `SELECT pst.id, pst.status, pst.expires_at, pst.share_type, pst.delivery_source,
            pst.dispatch_at, pst.dispatched_at, pst.gift_order_id, go.send_at AS gift_send_at,
            p.id AS poem_id, p.user_id, p.title, p.recipient_name, p.occasion, p.verses, p.og_variant
       FROM poem_share_tokens pst
       JOIN poems p ON p.id = pst.poem_id
       LEFT JOIN gift_orders go ON go.id = pst.gift_order_id
      WHERE pst.id = ?`,
      [shareTokenId],
    );
  }

  async function getPoemShareForViewer(shareTokenId) {
    return dbGet(
      db,
      `SELECT pst.id, pst.status, pst.expires_at, pst.share_type, pst.delivery_source,
            pst.dispatch_at, pst.dispatched_at, pst.gift_order_id, go.send_at AS gift_send_at,
            pst.poem_id, p.title, p.recipient_name, p.occasion, p.verses
       FROM poem_share_tokens pst
       LEFT JOIN poems p ON p.id = pst.poem_id
       LEFT JOIN gift_orders go ON go.id = pst.gift_order_id
      WHERE pst.id = ?`,
      [shareTokenId],
    );
  }

  async function getSongShareWithTrackDetails(shareTokenId) {
    return dbGet(
      db,
      `SELECT st.id, st.status, st.expires_at, st.share_type, st.track_id, st.track_version_id, st.gift_order_id,
            st.delivery_source, st.dispatch_at, st.dispatched_at,
            t.title, t.recipient_name, t.occasion, t.user_id,
            go.sender_display_name, go.recipient_name AS gift_recipient_name
       FROM share_tokens st
       LEFT JOIN tracks t ON t.id = st.track_id
       LEFT JOIN gift_orders go ON go.id = st.gift_order_id
      WHERE st.id = ?`,
      [shareTokenId],
    );
  }

  async function getContentShareReadyFields({ contentType, shareTokenId }) {
    const table = shareTableForContentType(contentType);
    assertShareTable(table);
    return dbGet(
      db,
      `SELECT st.id, st.status, st.expires_at, st.share_type, st.delivery_source,
            st.dispatch_at, st.dispatched_at, st.gift_order_id, go.send_at AS gift_send_at
       FROM ${table} st
       LEFT JOIN gift_orders go ON go.id = st.gift_order_id
      WHERE st.id = ?`,
      [shareTokenId],
    );
  }

  async function getSongShareDeviceState(shareTokenId) {
    return dbGet(
      db,
      "SELECT status, bound_device_id, bound_device_platform, expires_at, track_id, track_version_id FROM share_tokens WHERE id = ?",
      [shareTokenId],
    );
  }

  async function incrementSongShareAccess({ shareTokenId, accessedAt }) {
    return dbRun(
      db,
      "UPDATE share_tokens SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
      [accessedAt, shareTokenId],
    );
  }

  async function incrementSongShareClaimAttempts(shareTokenId) {
    return dbRun(
      db,
      "UPDATE share_tokens SET claim_attempts = claim_attempts + 1 WHERE id = ? AND claim_attempts < 5 AND status = 'unbound'",
      [shareTokenId],
    );
  }

  async function claimSongShare({
    shareTokenId,
    deviceId,
    platform,
    appVersion,
    claimUserId,
    claimAt,
    webStreamAllowed,
  }) {
    return dbRun(
      db,
      "UPDATE share_tokens SET status = ?, bound_device_id = ?, bound_device_platform = ?, bound_app_version = ?, bound_user_id = COALESCE(?, bound_user_id), bound_at = ?, web_stream_allowed = ?, claim_attempts = 0 WHERE id = ? AND bound_device_id IS NULL AND status = 'unbound'",
      [
        "claimed",
        deviceId,
        platform,
        appVersion,
        claimUserId,
        claimAt,
        webStreamAllowed ? 1 : 0,
        shareTokenId,
      ],
    );
  }

  async function getShareAccessSummary(shareTokenId) {
    const rows = await dbAll(
      db,
      "SELECT event_type, COUNT(*) as count, MAX(created_at) as last_at FROM share_access_log WHERE share_token_id = ? GROUP BY event_type",
      [shareTokenId],
    );
    return Array.from(rows);
  }

  async function getRecentShareAccessActivity(shareTokenId) {
    const rows = await dbAll(
      db,
      "SELECT event_type, metadata, created_at FROM share_access_log WHERE share_token_id = ? ORDER BY created_at DESC LIMIT 10",
      [shareTokenId],
    );
    return Array.from(rows);
  }

  async function getGiftShareBinding({ contentType, shareTokenId, query = null }) {
    const table = shareTableForContentType(contentType);
    assertShareTable(table);
    return dbGet(
      runner(query),
      `SELECT id, gift_order_id, delivery_source, dispatch_at FROM ${table} WHERE id = ?`,
      [shareTokenId],
    );
  }

  async function revokeGiftShare({
    contentType,
    shareTokenId,
    giftOrderId,
    expiresAt,
    query = null,
  }) {
    const table = shareTableForContentType(contentType);
    assertShareTable(table);
    if (table === "share_tokens") {
      return dbRun(
        runner(query),
        `UPDATE share_tokens
         SET status = 'revoked',
             web_stream_allowed = 0,
             expires_at = ?,
             dispatched_at = NULL
         WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`,
        [expiresAt, shareTokenId, giftOrderId],
      );
    }

    return dbRun(
      runner(query),
      `UPDATE poem_share_tokens
       SET status = 'revoked',
           expires_at = ?,
           dispatched_at = NULL
       WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`,
      [expiresAt, shareTokenId, giftOrderId],
    );
  }

  async function updateGiftShareSchedule({
    contentType,
    shareTokenId,
    giftOrderId,
    dispatchAt,
    expiresAt,
    query = null,
  }) {
    const table = shareTableForContentType(contentType);
    assertShareTable(table);
    return dbRun(
      runner(query),
      `UPDATE ${table}
       SET dispatch_at = ?,
           expires_at = ?,
           dispatched_at = NULL
       WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`,
      [dispatchAt, expiresAt, shareTokenId, giftOrderId],
    );
  }

  async function markGiftShareDispatched({
    contentType,
    shareTokenId,
    giftOrderId,
    dispatchedAt,
    scheduledAt,
    query = null,
  }) {
    const table = shareTableForContentType(contentType);
    assertShareTable(table);
    return dbRun(
      runner(query),
      `UPDATE ${table}
       SET dispatched_at = ?,
           dispatch_at = COALESCE(dispatch_at, ?),
           gift_order_id = COALESCE(gift_order_id, ?)
       WHERE id = ?`,
      [dispatchedAt, scheduledAt, giftOrderId, shareTokenId],
    );
  }

  async function revokeGiftDeliveryShare({
    contentType,
    shareTokenId,
    giftOrderId,
    query = null,
  }) {
    const table = shareTableForContentType(contentType);
    assertShareTable(table);
    if (table === "share_tokens") {
      return dbRun(
        runner(query),
        `UPDATE share_tokens
         SET status = 'revoked',
             web_stream_allowed = 0,
             dispatched_at = NULL
         WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`,
        [shareTokenId, giftOrderId],
      );
    }

    return dbRun(
      runner(query),
      `UPDATE poem_share_tokens
       SET status = 'revoked',
           dispatched_at = NULL
       WHERE id = ? AND gift_order_id = ? AND delivery_source = 'gift'`,
      [shareTokenId, giftOrderId],
    );
  }

  async function getLatestManualSongShare({ trackId, creatorId }) {
    return dbGet(
      db,
      `SELECT *
         FROM share_tokens
        WHERE track_id = ?
          AND creator_id = ?
          AND COALESCE(delivery_source, 'manual') != 'gift'
          AND status != 'revoked'
        ORDER BY created_at DESC
        LIMIT 1`,
      [trackId, creatorId],
    );
  }

  async function updateShareStatus(table, id, status) {
    assertShareTable(table);
    return dbRun(db, `UPDATE ${table} SET status = ? WHERE id = ?`, [
      status,
      id,
    ]);
  }

  async function upgradeShareToLifetime(table, id, { expiresAt, status }) {
    assertShareTable(table);
    return dbRun(
      db,
      `UPDATE ${table} SET share_type = ?, expires_at = ?, status = ? WHERE id = ?`,
      ["lifetime", expiresAt, status, id],
    );
  }

  async function clearUnboundSongSharePin(id) {
    return dbRun(
      db,
      "UPDATE share_tokens SET claim_pin = NULL, claim_attempts = 0 WHERE id = ?",
      [id],
    );
  }

  async function deleteExpiredOrRevokedSongShares(trackId) {
    return dbRun(
      db,
      "DELETE FROM share_tokens WHERE track_id = ? AND status IN ('expired', 'revoked')",
      [trackId],
    );
  }

  async function deleteExpiredOrRevokedPoemShares(poemId) {
    return dbRun(
      db,
      "DELETE FROM poem_share_tokens WHERE poem_id = ? AND status IN ('expired', 'revoked')",
      [poemId],
    );
  }

  async function insertSongShareToken(row) {
    return dbRun(
      db,
      "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, bound_device_id, bound_device_platform, bound_app_version, bound_at, web_stream_allowed, app_save_allowed, expires_at, created_at, last_accessed_at, access_count, stream_key_id, stream_key, claim_pin, claim_attempts, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        row.id,
        row.trackId,
        row.trackVersionId,
        row.creatorId,
        row.status,
        row.shareType,
        row.boundDeviceId,
        row.boundDevicePlatform,
        row.boundAppVersion,
        row.boundAt,
        row.webStreamAllowed ? 1 : 0,
        row.appSaveAllowed ? 1 : 0,
        row.expiresAt,
        row.createdAt,
        row.lastAccessedAt,
        row.accessCount,
        row.streamKeyId,
        row.streamKey,
        row.claimPin,
        row.claimAttempts,
        row.utmSource,
        row.utmMedium,
        row.utmCampaign,
        row.referrer,
        row.createdIp,
        row.createdUserAgent,
      ],
    );
  }

  async function setTrackShareToken({ trackId, shareTokenId, updatedAt }) {
    return dbRun(
      db,
      "UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?",
      [shareTokenId, updatedAt, trackId],
    );
  }

  async function insertPoemShareToken(row) {
    return dbRun(
      db,
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, share_type, claim_pin, claim_attempts, allow_save, expires_at,
        created_at, access_count, utm_source, utm_medium, utm_campaign, referrer, created_ip, created_user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.poemId,
        row.creatorId,
        row.status,
        row.shareType,
        row.claimPin,
        row.claimAttempts,
        row.allowSave ? 1 : 0,
        row.expiresAt,
        row.createdAt,
        row.accessCount,
        row.utmSource,
        row.utmMedium,
        row.utmCampaign,
        row.referrer,
        row.createdIp,
        row.createdUserAgent,
      ],
    );
  }

  async function setPoemShareToken({ poemId, shareTokenId, updatedAt }) {
    return dbRun(
      db,
      "UPDATE poems SET share_token_id = ?, updated_at = ? WHERE id = ?",
      [shareTokenId, updatedAt, poemId],
    );
  }

  return {
    getTrackSharePointer,
    getPoemSharePointer,
    getSongShareTokenById,
    getPoemShareTokenById,
    getTrackById,
    getTrackVersionById,
    getShareTrackPair,
    getGiftOrderSendAt,
    getGiftOrderSenderSummary,
    getUserDisplayName,
    getTrackNotificationMetadata,
    addPoemShareAccessLog,
    getPoemShareForOgImage,
    getPoemShareForViewer,
    getSongShareWithTrackDetails,
    getContentShareReadyFields,
    getSongShareDeviceState,
    incrementSongShareAccess,
    incrementSongShareClaimAttempts,
    claimSongShare,
    getShareAccessSummary,
    getRecentShareAccessActivity,
    getPoemShareTokenWithGiftSendAt,
    markPoemShareAccessed,
    insertPoemShareAccessLog,
    incrementPoemShareClaimAttempts,
    claimPoemShareForUser,
    getGiftShareBinding,
    revokeGiftShare,
    updateGiftShareSchedule,
    markGiftShareDispatched,
    revokeGiftDeliveryShare,
    getLatestManualSongShare,
    updateShareStatus,
    upgradeShareToLifetime,
    clearUnboundSongSharePin,
    deleteExpiredOrRevokedSongShares,
    deleteExpiredOrRevokedPoemShares,
    insertSongShareToken,
    setTrackShareToken,
    insertPoemShareToken,
    setPoemShareToken,
  };
}

module.exports = { createShareTokenRepository };
