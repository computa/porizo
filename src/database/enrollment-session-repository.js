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

  async function findActiveVoiceCloneForUser(userId) {
    return db
      .prepare(
        "SELECT elevenlabs_voice_id FROM voice_profiles WHERE user_id = ? AND status = 'active' AND elevenlabs_voice_id IS NOT NULL",
      )
      .get(userId);
  }

  async function findActiveVoiceProfileSummaryForUser(userId) {
    return db
      .prepare(
        "SELECT id, quality_score FROM voice_profiles WHERE user_id = ? AND status = 'active' LIMIT 1",
      )
      .get(userId);
  }

  async function markVoiceProfileReplaced({ profileId, deletedAt }) {
    return db
      .prepare("UPDATE voice_profiles SET status = ?, deleted_at = ? WHERE id = ?")
      .run("deleted", deletedAt, profileId);
  }

  async function insertVoiceProfile({
    id,
    userId,
    status,
    embeddingRef,
    qualityScore,
    qualityTier,
    qualityMetricsJson,
    modelVersion,
    consentVersion,
    consentAt,
    lastVerifiedAt,
    createdAt,
    elevenlabsVoiceId = null,
  }) {
    return db
      .prepare(
        "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at, elevenlabs_voice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        userId,
        status,
        embeddingRef,
        qualityScore,
        qualityTier,
        qualityMetricsJson,
        modelVersion,
        consentVersion,
        consentAt,
        lastVerifiedAt,
        createdAt,
        elevenlabsVoiceId,
      );
  }

  async function insertAuditLog({
    id,
    userId,
    action,
    resourceType,
    resourceId,
    metadataJson,
    createdAt,
  }) {
    return db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        userId,
        action,
        resourceType,
        resourceId,
        metadataJson,
        createdAt,
      );
  }

  async function deleteVoiceProfileAndClearAssets({ profileId, deletedAt }) {
    return db
      .prepare(
        "UPDATE voice_profiles SET status = ?, embedding_ref = ?, elevenlabs_voice_id = ?, deleted_at = ? WHERE id = ?",
      )
      .run("deleted", null, null, deletedAt, profileId);
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
    findActiveVoiceCloneForUser,
    findActiveVoiceProfileSummaryForUser,
    markVoiceProfileReplaced,
    insertVoiceProfile,
    insertAuditLog,
    deleteVoiceProfileAndClearAssets,
  };
}

module.exports = {
  createEnrollmentSessionRepository,
};
