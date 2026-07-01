"use strict";

const crypto = require("node:crypto");
const {
  createReceiverSessionRepository,
} = require("../database/receiver-session-repository");
const { generatePrefixedId } = require("../utils/ids");

const ALLOWED_EVENTS = new Set([
  "receiver_link_opened",
  "receiver_play_started",
  "receiver_play_completed",
  "receiver_save_cta_viewed",
  "receiver_save_cta_clicked",
  "receiver_app_opened",
  "receiver_claim_started",
  "receiver_claim_succeeded",
  "receiver_claim_failed",
]);

function normalizeContentKind(value) {
  return value === "poem" ? "poem" : "song";
}

function normalizeSessionId(value) {
  return typeof value === "string" && /^rs_[a-f0-9]{24}$/.test(value)
    ? value
    : null;
}

function safeMetadata(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return out;
  }
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= 20) break;
    if (!/^[a-zA-Z0-9_]{1,48}$/.test(key)) continue;
    if (typeof value === "string") {
      out[key] = value.slice(0, 256);
      count += 1;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = String(value);
      count += 1;
    } else if (typeof value === "boolean") {
      out[key] = value ? "true" : "false";
      count += 1;
    }
  }
  return out;
}

function safeMetadataJson(input) {
  const json = JSON.stringify(safeMetadata(input));
  return json.length > 2048 ? JSON.stringify({ truncated: "true" }) : json;
}

function isExpiredIso(value) {
  if (!value) return false;
  const expiresAtMs = Date.parse(value);
  return Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();
}

function createSessionSecret() {
  return crypto.randomBytes(24).toString("hex");
}

function hashSessionSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest("hex");
}

function timingSafeStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function validateSessionSecret(secret) {
  return typeof secret === "string" && /^[a-f0-9]{48}$/.test(secret) ? secret : null;
}

function validateReceiverClaimToken(token) {
  return typeof token === "string" && /^rc_[a-f0-9]{32}$/.test(token) ? token : null;
}

function createReceiverSessionService(db, options = {}) {
  const repository = options.repository || createReceiverSessionRepository(db);

  async function getSessionForShare(receiverSessionId, shareId, receiverSessionSecret = null) {
    const sessionId = normalizeSessionId(receiverSessionId);
    if (!sessionId || !shareId) return null;
    const row = await repository.findSessionById(sessionId);
    if (!row || row.share_id !== shareId) return null;
    const secret = validateSessionSecret(receiverSessionSecret);
    if (!secret || !row.receiver_session_secret_hash) return null;
    return timingSafeStringEqual(hashSessionSecret(secret), row.receiver_session_secret_hash) ? row : null;
  }

  async function getTrustedSessionForShare(receiverSessionId, shareId) {
    const sessionId = normalizeSessionId(receiverSessionId);
    if (!sessionId || !shareId) return null;
    const row = await repository.findSessionById(sessionId);
    return row && row.share_id === shareId ? row : null;
  }

  async function assertSessionEventCapacity(sessionId) {
    if ((await repository.countEventsForSession(sessionId)) >= 250) {
      const err = new Error("RECEIVER_SESSION_EVENT_LIMIT");
      err.code = "RECEIVER_SESSION_EVENT_LIMIT";
      throw err;
    }
  }

  async function rotateReceiverHandoffIfNeeded(session) {
    if (!session) return null;
    let currentSession = session;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!currentSession.handoff_resolved_at && !isExpiredIso(currentSession.handoff_expires_at)) {
        return currentSession.receiver_handoff_id;
      }
      const previousHandoffId = currentSession.receiver_handoff_id;
      const now = new Date().toISOString();
      const receiverHandoffId = generatePrefixedId("rh", 12);
      const handoffExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const result = await repository.rotateResolvedOrExpiredHandoff({
        receiverHandoffId,
        handoffExpiresAt,
        now,
        sessionId: currentSession.id,
        previousHandoffId,
      });
      if (result && Number(result.changes || 0) > 0) {
        return receiverHandoffId;
      }
      currentSession = await repository.findSessionById(currentSession.id);
      if (!currentSession) return null;
    }
    return currentSession.receiver_handoff_id;
  }

  async function recordEvent({
    receiverSessionId,
    receiverSessionSecret,
    shareId,
    contentKind,
    eventName,
    metadata,
    ip,
    userAgent,
    createIfMissing = true,
    rotateResolvedHandoff = true,
    trustedReceiverSession = false,
  }) {
    if (!ALLOWED_EVENTS.has(eventName)) {
      const err = new Error("INVALID_RECEIVER_EVENT");
      err.code = "INVALID_RECEIVER_EVENT";
      throw err;
    }
    if (!shareId) {
      const err = new Error("INVALID_SHARE");
      err.code = "INVALID_SHARE";
      throw err;
    }

    const now = new Date().toISOString();
    const kind = normalizeContentKind(contentKind);
    let session = trustedReceiverSession
      ? await getTrustedSessionForShare(receiverSessionId, shareId)
      : await getSessionForShare(receiverSessionId, shareId, receiverSessionSecret);
    let sessionId = session?.id || null;
    let receiverHandoffId = session && rotateResolvedHandoff
      ? await rotateReceiverHandoffIfNeeded(session)
      : session?.receiver_handoff_id || null;
    let sessionSecret = receiverSessionSecret || null;

    if (!sessionId) {
      if (!createIfMissing) {
        return { receiverSessionId: null, receiverSessionSecret: null, receiverHandoffId: null, eventId: null, recorded: false };
      }
      sessionId = generatePrefixedId("rs", 12);
      sessionSecret = createSessionSecret();
      receiverHandoffId = generatePrefixedId("rh", 12);
      const handoffExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await repository.createSession({
        sessionId,
        shareId,
        contentKind: kind,
        receiverHandoffId,
        receiverSessionSecretHash: hashSessionSecret(sessionSecret),
        handoffExpiresAt,
        eventName,
        ip,
        userAgent,
        now,
      });
    } else {
      await repository.updateSessionLastEvent({
        sessionId,
        eventName,
        ip,
        userAgent,
        now,
      });
    }

    await assertSessionEventCapacity(sessionId);

    const eventId = generatePrefixedId("rse", 12);
    await repository.createEvent({
      eventId,
      receiverSessionId: sessionId,
      shareId,
      eventName,
      metadataJson: safeMetadataJson(metadata),
      ip,
      userAgent,
      now,
    });

    return { receiverSessionId: sessionId, receiverSessionSecret: sessionSecret || null, receiverHandoffId, eventId, recorded: true };
  }

  async function recordExistingSessionEvent(args) {
    return recordEvent({ ...args, createIfMissing: false });
  }

  async function lookupHandoff(handoffId) {
    if (typeof handoffId !== "string" || !/^rh_[a-f0-9]{24}$/.test(handoffId)) {
      return null;
    }
    const row = await repository.findHandoff(handoffId);
    if (!row) return null;
    if (isExpiredIso(row.handoff_expires_at)) return null;
    return {
      shareId: row.share_id,
      receiverSessionId: row.id,
      contentKind: normalizeContentKind(row.content_kind),
      handoffResolvedAt: row.handoff_resolved_at || null,
    };
  }

  async function consumeHandoff(handoffId) {
    if (typeof handoffId !== "string" || !/^rh_[a-f0-9]{24}$/.test(handoffId)) {
      return false;
    }
    const now = new Date().toISOString();
    const result = await repository.consumeHandoff(handoffId, now);
    return Boolean(result && Number(result.changes || 0) > 0);
  }

  async function resolveHandoff(handoffId) {
    const handoff = await lookupHandoff(handoffId);
    if (!handoff || handoff.handoffResolvedAt) return null;
    const consumed = await consumeHandoff(handoffId);
    return consumed ? handoff : null;
  }

  async function markAppOpened({ receiverSessionId, shareId, contentKind, userId, ip, userAgent }) {
    const result = await recordEvent({
      receiverSessionId,
      shareId,
      contentKind,
      eventName: "receiver_app_opened",
      metadata: { matched_user_id: userId || "" },
      ip,
      userAgent,
      rotateResolvedHandoff: false,
      trustedReceiverSession: true,
    });
    if (userId && result.receiverSessionId) {
      await repository.setMatchedUser({
        sessionId: result.receiverSessionId,
        userId,
        now: new Date().toISOString(),
      });
    }
    return result;
  }

  async function issueReceiverClaimToken({ receiverSessionId, shareId, contentKind }) {
    const session = await getTrustedSessionForShare(receiverSessionId, shareId);
    if (!session || normalizeContentKind(contentKind) !== normalizeContentKind(session.content_kind)) {
      return null;
    }
    const claimToken = generatePrefixedId("rc", 16);
    const now = new Date().toISOString();
    const claimTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const claimTokenHash = hashSessionSecret(claimToken);
    const result = await repository.setReceiverClaimToken({
      sessionId: session.id,
      shareId,
      claimTokenHash,
      claimTokenExpiresAt,
      now,
    });
    if (!result || Number(result.changes || 0) === 0) {
      return null;
    }
    await repository.createReceiverClaimToken({
      claimTokenHash,
      receiverSessionId: session.id,
      shareId,
      contentKind: normalizeContentKind(contentKind),
      expiresAt: claimTokenExpiresAt,
      now,
    });
    return {
      receiverClaimToken: claimToken,
      expiresAt: claimTokenExpiresAt,
    };
  }

  async function lookupReceiverClaimToken(claimToken, { allowConsumed = false } = {}) {
    const token = validateReceiverClaimToken(claimToken);
    if (!token) return null;
    const claimTokenHash = hashSessionSecret(token);
    const tokenRow = await repository.findReceiverClaimToken(claimTokenHash);
    if (tokenRow) {
      if (isExpiredIso(tokenRow.expires_at) || (!allowConsumed && tokenRow.consumed_at)) {
        return null;
      }
      return {
        receiverSessionId: tokenRow.receiver_session_id,
        shareId: tokenRow.share_id,
        contentKind: normalizeContentKind(tokenRow.content_kind),
        expiresAt: tokenRow.expires_at,
        consumedAt: tokenRow.consumed_at || null,
      };
    }

    const row = await repository.findSessionClaimToken(claimTokenHash);
    if (!row || isExpiredIso(row.claim_token_expires_at)) {
      return null;
    }
    return {
      receiverSessionId: row.id,
      shareId: row.share_id,
      contentKind: normalizeContentKind(row.content_kind),
      expiresAt: row.claim_token_expires_at,
    };
  }

  async function consumeReceiverClaimToken(claimToken) {
    const token = validateReceiverClaimToken(claimToken);
    if (!token) return false;
    const now = new Date().toISOString();
    const claimTokenHash = hashSessionSecret(token);
    const row = await repository.findUnconsumedReceiverClaimToken(claimTokenHash);
    if (!row) return false;
    const result = await repository.consumeReceiverClaimToken(claimTokenHash, now);
    if (!result || Number(result.changes || 0) === 0) {
      return false;
    }
    await repository.markHandoffResolvedIfUnset({
      receiverSessionId: row.receiver_session_id,
      now,
    });
    return true;
  }

  return {
    recordEvent,
    recordExistingSessionEvent,
    getSessionForShare,
    lookupHandoff,
    consumeHandoff,
    resolveHandoff,
    markAppOpened,
    issueReceiverClaimToken,
    lookupReceiverClaimToken,
    consumeReceiverClaimToken,
  };
}

module.exports = { createReceiverSessionService, ALLOWED_EVENTS };
