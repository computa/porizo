"use strict";

function createReceiverSessionRepository(db) {
  function normalizeRunResult(result) {
    const changes = Number(result?.changes ?? result?.rowCount ?? 0);
    return {
      ...result,
      changes,
      rowCount: changes,
      attributed: changes > 0,
    };
  }

  async function findSessionById(sessionId) {
    return db.prepare("SELECT * FROM receiver_sessions WHERE id = ?").get(sessionId);
  }

  async function countEventsForSession(sessionId) {
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM receiver_session_events WHERE receiver_session_id = ?",
      )
      .get(sessionId);
    return Number(row?.count || 0);
  }

  async function rotateResolvedOrExpiredHandoff({
    receiverHandoffId,
    handoffExpiresAt,
    now,
    sessionId,
    previousHandoffId,
  }) {
    return db
      .prepare(
        `UPDATE receiver_sessions
        SET receiver_handoff_id = ?, handoff_expires_at = ?, handoff_resolved_at = NULL, updated_at = ?
        WHERE id = ?
          AND receiver_handoff_id = ?
          AND (
            handoff_resolved_at IS NOT NULL
            OR (handoff_expires_at IS NOT NULL AND handoff_expires_at < ?)
          )`,
      )
      .run(receiverHandoffId, handoffExpiresAt, now, sessionId, previousHandoffId, now);
  }

  async function createSession({
    sessionId,
    shareId,
    contentKind,
    receiverHandoffId,
    receiverSessionSecretHash,
    handoffExpiresAt,
    eventName,
    ip,
    userAgent,
    now,
  }) {
    return db
      .prepare(
        `INSERT INTO receiver_sessions
        (id, share_id, content_kind, receiver_handoff_id, receiver_session_secret_hash, handoff_expires_at, first_event_name, last_event_name, first_ip_address, last_ip_address, first_user_agent, last_user_agent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        shareId,
        contentKind,
        receiverHandoffId,
        receiverSessionSecretHash,
        handoffExpiresAt,
        eventName,
        eventName,
        ip || null,
        ip || null,
        userAgent || null,
        userAgent || null,
        now,
        now,
      );
  }

  async function updateSessionLastEvent({
    sessionId,
    eventName,
    ip,
    userAgent,
    now,
  }) {
    return db
      .prepare(
        `UPDATE receiver_sessions
        SET last_event_name = ?, last_ip_address = ?, last_user_agent = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(eventName, ip || null, userAgent || null, now, sessionId);
  }

  async function createEvent({
    eventId,
    receiverSessionId,
    shareId,
    eventName,
    metadataJson,
    ip,
    userAgent,
    now,
  }) {
    return db
      .prepare(
        `INSERT INTO receiver_session_events
      (id, receiver_session_id, share_id, event_name, metadata_json, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        receiverSessionId,
        shareId,
        eventName,
        metadataJson,
        ip || null,
        userAgent || null,
        now,
      );
  }

  async function findHandoff(handoffId) {
    return db
      .prepare(
        `SELECT id, share_id, content_kind, handoff_expires_at, handoff_resolved_at
      FROM receiver_sessions
      WHERE receiver_handoff_id = ?`,
      )
      .get(handoffId);
  }

  async function consumeHandoff(handoffId, now) {
    return db
      .prepare(
        "UPDATE receiver_sessions SET handoff_resolved_at = ?, updated_at = ? WHERE receiver_handoff_id = ? AND handoff_resolved_at IS NULL",
      )
      .run(now, now, handoffId);
  }

  async function setMatchedUser({ sessionId, userId, now }) {
    return db
      .prepare("UPDATE receiver_sessions SET matched_user_id = ?, updated_at = ? WHERE id = ?")
      .run(userId, now, sessionId);
  }

  async function setReceiverClaimToken({
    sessionId,
    shareId,
    claimTokenHash,
    claimTokenExpiresAt,
    now,
  }) {
    return db
      .prepare(
        `UPDATE receiver_sessions
      SET receiver_claim_token_hash = ?, claim_token_expires_at = ?, updated_at = ?
      WHERE id = ? AND share_id = ?`,
      )
      .run(claimTokenHash, claimTokenExpiresAt, now, sessionId, shareId);
  }

  async function createReceiverClaimToken({
    claimTokenHash,
    receiverSessionId,
    shareId,
    contentKind,
    expiresAt,
    now,
  }) {
    return db
      .prepare(
        `INSERT INTO receiver_claim_tokens
      (token_hash, receiver_session_id, share_id, content_kind, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(claimTokenHash, receiverSessionId, shareId, contentKind, expiresAt, now);
  }

  async function findReceiverClaimToken(claimTokenHash) {
    return db
      .prepare(
        `SELECT receiver_session_id, share_id, content_kind, expires_at, consumed_at
      FROM receiver_claim_tokens
      WHERE token_hash = ?`,
      )
      .get(claimTokenHash);
  }

  async function findSessionClaimToken(claimTokenHash) {
    return db
      .prepare(
        `SELECT id, share_id, content_kind, claim_token_expires_at
      FROM receiver_sessions
      WHERE receiver_claim_token_hash = ?`,
      )
      .get(claimTokenHash);
  }

  async function findUnconsumedReceiverClaimToken(claimTokenHash) {
    return db
      .prepare(
        `SELECT receiver_session_id
      FROM receiver_claim_tokens
      WHERE token_hash = ? AND consumed_at IS NULL`,
      )
      .get(claimTokenHash);
  }

  async function consumeReceiverClaimToken(claimTokenHash, now) {
    return db
      .prepare(
        `UPDATE receiver_claim_tokens
      SET consumed_at = ?
      WHERE token_hash = ? AND consumed_at IS NULL`,
      )
      .run(now, claimTokenHash);
  }

  async function markHandoffResolvedIfUnset({ receiverSessionId, now }) {
    return db
      .prepare(
        `UPDATE receiver_sessions
      SET handoff_resolved_at = COALESCE(handoff_resolved_at, ?), updated_at = ?
      WHERE id = ?`,
      )
      .run(now, now, receiverSessionId);
  }

  async function markDownloadAttributedByHandoff({
    receiverSessionId,
    receiverHandoffId,
    now,
  }) {
    const result = await db
      .prepare(
        `UPDATE receiver_sessions
      SET download_attributed_at = ?, updated_at = ?
      WHERE id = ?
        AND receiver_handoff_id = ?
        AND handoff_resolved_at IS NULL
        AND (handoff_expires_at IS NULL OR handoff_expires_at > ?)
        AND download_attributed_at IS NULL`,
      )
      .run(now, now, receiverSessionId, receiverHandoffId, now);
    return normalizeRunResult(result);
  }

  async function matchRecentUnmatchedSessionByIp({
    userId,
    clientIp,
    cutoff,
    now,
  }) {
    const result = await db
      .prepare(
        `UPDATE receiver_sessions
      SET matched_user_id = ?, updated_at = ?
      WHERE id = (
        SELECT id
        FROM receiver_sessions
        WHERE matched_user_id IS NULL
          AND (last_ip_address = ? OR first_ip_address = ?)
          AND created_at > ?
        ORDER BY updated_at DESC LIMIT 1
      )
        AND matched_user_id IS NULL`,
      )
      .run(userId, now, clientIp, clientIp, cutoff);
    return normalizeRunResult(result);
  }

  return {
    findSessionById,
    countEventsForSession,
    rotateResolvedOrExpiredHandoff,
    createSession,
    updateSessionLastEvent,
    createEvent,
    findHandoff,
    consumeHandoff,
    setMatchedUser,
    setReceiverClaimToken,
    createReceiverClaimToken,
    findReceiverClaimToken,
    findSessionClaimToken,
    findUnconsumedReceiverClaimToken,
    consumeReceiverClaimToken,
    markHandoffResolvedIfUnset,
    markDownloadAttributedByHandoff,
    matchRecentUnmatchedSessionByIp,
  };
}

module.exports = { createReceiverSessionRepository };
