"use strict";

function createEnrollmentSessionRepository(db) {
  async function findById(sessionId) {
    return db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(sessionId);
  }

  async function findTokenContextById(sessionId) {
    return db
      .prepare(
        "SELECT id, user_id, access_token, consent_version, consent_scopes FROM enrollment_sessions WHERE id = ?",
      )
      .get(sessionId);
  }

  async function createSession({
    id,
    userId,
    status = "recording",
    promptSetId,
    promptsJson,
    chunkCount = 0,
    qualityMetricsJson,
    failureReason = null,
    startedAt,
    completedAt = null,
    expiresAt,
    consentVersion,
    consentScopes = null,
  }) {
    return db
      .prepare(
        "INSERT INTO enrollment_sessions (id, user_id, status, prompt_set_id, prompts_json, chunk_count, quality_metrics, failure_reason, started_at, completed_at, expires_at, consent_version, consent_scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        userId,
        status,
        promptSetId,
        promptsJson,
        chunkCount,
        qualityMetricsJson,
        failureReason,
        startedAt,
        completedAt,
        expiresAt,
        consentVersion,
        consentScopes,
      );
  }

  async function markStatus({ sessionId, status }) {
    return db
      .prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?")
      .run(status, sessionId);
  }

  async function markCompletedStatus({ sessionId, status, completedAt }) {
    return db
      .prepare(
        "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?",
      )
      .run(status, completedAt, sessionId);
  }

  async function claimForFinalization({ sessionId, userId }) {
    return db
      .prepare(
        "UPDATE enrollment_sessions SET status = ? WHERE id = ? AND user_id = ? AND status IN ('recording', 'processing')",
      )
      .run("finalizing", sessionId, userId);
  }

  async function setQualityMetrics({ sessionId, qualityMetricsJson }) {
    return db
      .prepare("UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?")
      .run(qualityMetricsJson, sessionId);
  }

  async function incrementChunkCountAndSetQualityMetrics({
    sessionId,
    qualityMetricsJson,
    status,
  }) {
    if (status) {
      return db
        .prepare(
          "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, status = ?, quality_metrics = ? WHERE id = ?",
        )
        .run(status, qualityMetricsJson, sessionId);
    }
    return db
      .prepare(
        "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, quality_metrics = ? WHERE id = ?",
      )
      .run(qualityMetricsJson, sessionId);
  }

  async function setConsentScopesIfMissing({ sessionId, consentScopes }) {
    return db
      .prepare(
        "UPDATE enrollment_sessions SET consent_scopes = ? WHERE id = ? AND consent_scopes IS NULL",
      )
      .run(consentScopes, sessionId);
  }

  async function setChunkQualityJson({ sessionId, chunkQualityJson }) {
    return db
      .prepare(
        "UPDATE enrollment_sessions SET chunk_quality_json = ? WHERE id = ?",
      )
      .run(chunkQualityJson, sessionId);
  }

  async function clearAccessTokenBySessionId(sessionId) {
    return db
      .prepare("UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?")
      .run(sessionId);
  }

  async function clearAccessTokensByUserId(userId) {
    return db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE user_id = ?",
      )
      .run(userId);
  }

  async function setAccessTokenBySessionId({ sessionId, accessToken }) {
    return db
      .prepare("UPDATE enrollment_sessions SET access_token = ? WHERE id = ?")
      .run(accessToken, sessionId);
  }

  return {
    findById,
    findTokenContextById,
    createSession,
    markStatus,
    markCompletedStatus,
    claimForFinalization,
    setQualityMetrics,
    incrementChunkCountAndSetQualityMetrics,
    setConsentScopesIfMissing,
    setChunkQualityJson,
    clearAccessTokenBySessionId,
    clearAccessTokensByUserId,
    setAccessTokenBySessionId,
  };
}

module.exports = {
  createEnrollmentSessionRepository,
};
