/**
 * Enrollment Session Service
 *
 * Centralizes reads and security-sensitive writes against `enrollment_sessions`.
 * Per docs/plans/2026-05-05-002-fix-suno-voice-persona-architecture-findings-plan.md U3:
 *   - All `UPDATE enrollment_sessions SET access_token = NULL` SQL goes through
 *     this module (was scattered across 3 modules with subtle drift).
 *   - All `SELECT * FROM enrollment_sessions WHERE id = ?` reads go through
 *     `getEnrollmentSession` so the persona service no longer reaches into
 *     enrollment-domain SQL directly.
 *   - Token revocation emits a structured audit log entry so divergent
 *     revocation behavior is observable.
 */

const crypto = require("node:crypto");

const REVOCATION_EVENT = "enrollment_session_token_revoked";

// Per-process HMAC key for log redaction. When LOG_ID_HMAC_KEY is set, IDs
// hash consistently across all process instances (good for cross-log
// forensics). When unset, each process generates its own — IDs hash
// consistently within a process but rotate on restart, which prevents
// trivial long-term correlation. NOT a substitute for a real audit log;
// this is "make IDs unsearchable in journalctl".
const LOG_ID_HMAC_KEY =
  process.env.LOG_ID_HMAC_KEY || crypto.randomBytes(16).toString("hex");

function hashIdForLog(id) {
  if (typeof id !== "string" || !id) return null;
  return crypto
    .createHmac("sha256", LOG_ID_HMAC_KEY)
    .update(id)
    .digest("hex")
    .slice(0, 16);
}

function logRevocation(scope, sessionId, userId) {
  console.log(
    JSON.stringify({
      event: REVOCATION_EVENT,
      scope,
      session_id_hmac: hashIdForLog(sessionId),
      user_id_hmac: hashIdForLog(userId),
    }),
  );
}

/**
 * Fetch an enrollment session by id with the columns persona-service consumers
 * need. Returns `null` when not found.
 */
async function getEnrollmentSession(db, sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }
  return db
    .prepare(
      "SELECT id, user_id, access_token, consent_version, consent_scopes FROM enrollment_sessions WHERE id = ?",
    )
    .get(sessionId);
}

/**
 * Revoke (clear) the access_token on a single enrollment session.
 *
 * Used after the persona-service has finished consuming the token for a Suno
 * upload-cover task, or after a permanent persona failure. Idempotent — calls
 * against unknown session IDs simply affect 0 rows.
 */
async function revokeEnrollmentSessionToken(db, sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return { affected: 0 };
  }
  const result = await db
    .prepare("UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?")
    .run(sessionId);
  logRevocation("session", sessionId, null);
  return { affected: result?.changes ?? result?.rowCount ?? 0 };
}

/**
 * Revoke (clear) the access_token on every enrollment session for a user.
 *
 * Used by the GDPR account-delete path and the global logout path. Distinct
 * from `revokeEnrollmentSessionToken` because the predicate (and intent) is
 * different — these two MUST NOT share an implementation that papers over
 * the difference.
 */
async function revokeAllEnrollmentSessionTokensForUser(db, userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    return { affected: 0 };
  }
  const result = await db
    .prepare(
      "UPDATE enrollment_sessions SET access_token = NULL WHERE user_id = ?",
    )
    .run(userId);
  logRevocation("user", null, userId);
  return { affected: result?.changes ?? result?.rowCount ?? 0 };
}

module.exports = {
  getEnrollmentSession,
  revokeEnrollmentSessionToken,
  revokeAllEnrollmentSessionTokensForUser,
};
