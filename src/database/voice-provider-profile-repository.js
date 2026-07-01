"use strict";

function resultChanges(result) {
  return result?.changes ?? result?.rowCount ?? 0;
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function mapVoiceProviderJobExecutionContext(row) {
  const job = row
    ? {
        id: row.job_id,
        voice_profile_id: row.job_voice_profile_id,
        user_id: row.job_user_id,
        provider: row.job_provider,
        voice_provider_profile_id: row.job_voice_provider_profile_id,
        status: row.job_status,
        step: row.job_step,
        attempts: row.job_attempts,
        max_attempts: row.job_max_attempts,
        step_data: row.job_step_data,
        last_error: row.job_last_error,
        next_attempt_at: row.job_next_attempt_at,
        created_at: row.job_created_at,
        updated_at: row.job_updated_at,
        locked_at: row.job_locked_at,
        locked_by: row.job_locked_by,
        cancellation_requested_at: row.job_cancellation_requested_at,
        cancelled_at: row.job_cancelled_at,
        completed_at: row.job_completed_at,
      }
    : null;
  const providerProfile = row?.profile_id
    ? {
        id: row.profile_id,
        voice_profile_id: row.profile_voice_profile_id,
        user_id: row.profile_user_id,
        provider: row.profile_provider,
        provider_profile_id: row.profile_provider_profile_id,
        status: row.profile_status,
        source_upload_url: row.profile_source_upload_url,
        source_task_id: row.profile_source_task_id,
        source_audio_id: row.profile_source_audio_id,
        model: row.profile_model,
        consent_scope: row.profile_consent_scope,
        metadata_json: row.profile_metadata_json,
        last_error: row.profile_last_error,
        created_at: row.profile_created_at,
        updated_at: row.profile_updated_at,
        activated_at: row.profile_activated_at,
        deleted_at: row.profile_deleted_at,
        voice_profile_status: row.voice_profile_status,
      }
    : null;
  const session = row?.session_id
    ? {
        id: row.session_id,
        user_id: row.session_user_id,
        access_token: row.session_access_token,
        consent_version: row.session_consent_version,
        consent_scopes: row.session_consent_scopes,
      }
    : null;
  return { job, providerProfile, session };
}

function createVoiceProviderProfileRepository(db) {
  async function getProviderProfileById(id) {
    return db
      .prepare("SELECT * FROM voice_provider_profiles WHERE id = ?")
      .get(id);
  }

  async function hasActiveVoiceProfileForUser(userId) {
    const row = await db
      .prepare(
        "SELECT 1 FROM voice_profiles WHERE user_id = ? AND status = 'active' LIMIT 1",
      )
      .get(userId);
    return Boolean(row);
  }

  async function findActiveVoiceProfileForUser(userId) {
    return db
      .prepare(
        "SELECT * FROM voice_profiles WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId);
  }

  async function findLatestNonDeletedVoiceProfileForUser(userId) {
    return db
      .prepare(
        "SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId);
  }

  async function findActiveVoiceProfileIdForUser(userId) {
    return db
      .prepare("SELECT id FROM voice_profiles WHERE user_id = ? AND status = 'active'")
      .get(userId);
  }

  async function findVoiceProfileStatus({ voiceProfileId, userId }) {
    return db
      .prepare("SELECT id, status FROM voice_profiles WHERE id = ? AND user_id = ?")
      .get(voiceProfileId, userId);
  }

  async function findDeletableVoiceProfileForUser(userId) {
    return db
      .prepare("SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted'")
      .get(userId);
  }

  async function insertProviderProfile({
    id,
    voiceProfileId,
    userId,
    provider,
    status,
    consentScope,
    metadataJson,
    createdAt,
    updatedAt,
  }) {
    return db
      .prepare(
        `INSERT INTO voice_provider_profiles (
        id, voice_profile_id, user_id, provider, status, consent_scope,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        voiceProfileId,
        userId,
        provider,
        status,
        consentScope || null,
        metadataJson,
        createdAt,
        updatedAt,
      );
  }

  async function findLatestProviderProfileForVoiceProfile({
    voiceProfileId,
    provider,
    includeDeleted = false,
  }) {
    const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
    return db
      .prepare(
        `SELECT * FROM voice_provider_profiles
       WHERE voice_profile_id = ? AND provider = ? ${deletedClause}
       ORDER BY created_at DESC
       LIMIT 1`,
      )
      .get(voiceProfileId, provider);
  }

  async function findActiveProviderProfileForUser({ userId, provider }) {
    return db
      .prepare(
        `SELECT vpp.*
         FROM voice_provider_profiles vpp
         JOIN voice_profiles vp
           ON vp.id = vpp.voice_profile_id
          AND vp.user_id = vpp.user_id
          AND vp.status = 'active'
        WHERE vpp.user_id = ?
          AND vpp.provider = ?
          AND vpp.status = 'active'
          AND vpp.deleted_at IS NULL
        ORDER BY vpp.activated_at DESC, vpp.created_at DESC
        LIMIT 1`,
      )
      .get(userId, provider);
  }

  async function findLatestPendingProviderProfileForUser({
    userId,
    provider,
    statuses,
  }) {
    return db
      .prepare(
        `SELECT vpp.*
         FROM voice_provider_profiles vpp
         JOIN voice_profiles vp
           ON vp.id = vpp.voice_profile_id
          AND vp.user_id = vpp.user_id
        WHERE vpp.user_id = ?
          AND vpp.provider = ?
          AND vpp.status IN (${placeholders(statuses)})
          AND vpp.deleted_at IS NULL
          AND vp.deleted_at IS NULL
        ORDER BY vpp.created_at DESC
        LIMIT 1`,
      )
      .get(userId, provider, ...statuses);
  }

  async function getLatestVoiceProviderJobForProfile(providerProfileId) {
    return db
      .prepare(
        `SELECT *
           FROM voice_provider_jobs
          WHERE voice_provider_profile_id = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`,
      )
      .get(providerProfileId);
  }

  async function listProviderProfilesForVoiceProfile({
    voiceProfileId,
    userId,
    includeDeleted = false,
  }) {
    const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
    return db
      .prepare(
        `SELECT id, voice_profile_id, provider, status
           FROM voice_provider_profiles
          WHERE voice_profile_id = ?
            AND user_id = ?
            ${deletedClause}`,
      )
      .all(voiceProfileId, userId);
  }

  async function listProviderProfilesForUser({ userId, includeDeleted = false }) {
    const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
    return db
      .prepare(
        `SELECT id, voice_profile_id, provider, status
           FROM voice_provider_profiles
          WHERE user_id = ?
            ${deletedClause}`,
      )
      .all(userId);
  }

  async function updateProviderProfileMetadata({
    id,
    metadataJson,
    lastError,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_profiles
            SET metadata_json = ?, last_error = COALESCE(?, last_error),
                updated_at = ?
          WHERE id = ?`,
      )
      .run(metadataJson, lastError, updatedAt, id);
  }

  async function listOlderActiveVoiceProfilesForUser({
    userId,
    activeVoiceProfileId,
  }) {
    return db
      .prepare(
        `SELECT id
           FROM voice_profiles
          WHERE user_id = ?
            AND status = 'active'
            AND id != ?
            AND deleted_at IS NULL`,
      )
      .all(userId, activeVoiceProfileId);
  }

  async function markVoiceProfileDeleted({ id, userId, status, deletedAt }) {
    return db
      .prepare(
        "UPDATE voice_profiles SET status = ?, deleted_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(status, deletedAt, id, userId);
  }

  async function updateProviderProfileUploadSubmitted({
    id,
    status,
    sourceUploadUrl,
    metadataJson,
    updatedAt,
    allowedStatuses,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?, source_upload_url = ?,
              metadata_json = COALESCE(?, metadata_json),
              last_error = NULL, updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(status, sourceUploadUrl || null, metadataJson, updatedAt, id, ...allowedStatuses);
  }

  async function updateProviderProfileCoverSubmitted({
    id,
    status,
    sourceTaskId,
    model,
    metadataJson,
    updatedAt,
    allowedStatuses,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?, source_task_id = ?,
              model = COALESCE(?, model),
              metadata_json = COALESCE(?, metadata_json), last_error = NULL,
              updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(
        status,
        sourceTaskId,
        model || null,
        metadataJson,
        updatedAt,
        id,
        ...allowedStatuses,
      );
  }

  async function updateProviderProfilePersonaSubmitted({
    id,
    status,
    sourceTaskId,
    sourceAudioId,
    model,
    metadataJson,
    updatedAt,
    allowedStatuses,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?, source_task_id = ?, source_audio_id = ?,
              source_upload_url = NULL, model = ?,
              metadata_json = COALESCE(?, metadata_json), last_error = NULL,
              updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(
        status,
        sourceTaskId,
        sourceAudioId,
        model || null,
        metadataJson,
        updatedAt,
        id,
        ...allowedStatuses,
      );
  }

  async function updateProviderProfileActive({
    id,
    status,
    providerProfileId,
    model,
    metadataJson,
    activatedAt,
    updatedAt,
    allowedStatuses,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?, provider_profile_id = ?,
              model = COALESCE(?, model),
              metadata_json = COALESCE(?, metadata_json), last_error = NULL,
              activated_at = ?, updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(
        status,
        providerProfileId,
        model || null,
        metadataJson,
        activatedAt,
        updatedAt,
        id,
        ...allowedStatuses,
      );
  }

  async function markVoiceProfileActive({
    voiceProfileId,
    userId,
    lastVerifiedAt,
    allowedStatuses,
  }) {
    return db
      .prepare(
        `UPDATE voice_profiles
            SET status = 'active', last_verified_at = COALESCE(last_verified_at, ?)
          WHERE id = ?
            AND user_id = ?
            AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(lastVerifiedAt, voiceProfileId, userId, ...allowedStatuses);
  }

  async function updateProviderProfileFailed({
    id,
    status,
    providerProfileId,
    lastError,
    metadataJson,
    updatedAt,
    includeDeleted = false,
  }) {
    const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
    return db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?, provider_profile_id = COALESCE(?, provider_profile_id),
              last_error = ?, metadata_json = COALESCE(?, metadata_json),
              updated_at = ?
        WHERE id = ? ${deletedClause}`,
      )
      .run(status, providerProfileId || null, lastError, metadataJson, updatedAt, id);
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
        userId || null,
        action,
        resourceType,
        resourceId,
        metadataJson,
        createdAt,
      );
  }

  async function softDeleteProviderProfilesForVoiceProfile({
    voiceProfileId,
    userId,
    provider,
    status,
    lastError,
    deletedAt,
    updatedAt,
  }) {
    const params = [
      status,
      lastError,
      deletedAt,
      updatedAt,
      voiceProfileId,
      userId,
    ];
    let providerClause = "";
    if (provider) {
      providerClause = "AND provider = ?";
      params.push(provider);
    }
    const result = await db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?, provider_profile_id = NULL, source_upload_url = NULL,
              source_task_id = NULL, source_audio_id = NULL, last_error = ?,
              deleted_at = ?, updated_at = ?
        WHERE voice_profile_id = ?
          AND user_id = ?
          AND deleted_at IS NULL
          ${providerClause}`,
      )
      .run(...params);
    return resultChanges(result);
  }

  async function softDeleteProviderProfilesForUser({
    userId,
    status,
    lastError,
    deletedAt,
    updatedAt,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_profiles
          SET status = ?,
              provider_profile_id = NULL,
              source_upload_url = NULL,
              source_task_id = NULL,
              source_audio_id = NULL,
              last_error = ?,
              deleted_at = ?,
              updated_at = ?
        WHERE user_id = ?
          AND deleted_at IS NULL`,
      )
      .run(status, lastError, deletedAt, updatedAt, userId);
    return resultChanges(result);
  }

  async function getVoiceProviderJobById(id) {
    return db.prepare("SELECT * FROM voice_provider_jobs WHERE id = ?").get(id);
  }

  async function getVoiceProviderJobExecutionContext({
    jobId,
    providerProfileId,
    sessionId,
  }) {
    const row = await db
      .prepare(
        `SELECT
          j.id AS job_id,
          j.voice_profile_id AS job_voice_profile_id,
          j.user_id AS job_user_id,
          j.provider AS job_provider,
          j.voice_provider_profile_id AS job_voice_provider_profile_id,
          j.status AS job_status,
          j.step AS job_step,
          j.attempts AS job_attempts,
          j.max_attempts AS job_max_attempts,
          j.step_data AS job_step_data,
          j.last_error AS job_last_error,
          j.next_attempt_at AS job_next_attempt_at,
          j.created_at AS job_created_at,
          j.updated_at AS job_updated_at,
          j.locked_at AS job_locked_at,
          j.locked_by AS job_locked_by,
          j.cancellation_requested_at AS job_cancellation_requested_at,
          j.cancelled_at AS job_cancelled_at,
          j.completed_at AS job_completed_at,
          p.id AS profile_id,
          p.voice_profile_id AS profile_voice_profile_id,
          p.user_id AS profile_user_id,
          p.provider AS profile_provider,
          p.provider_profile_id AS profile_provider_profile_id,
          p.status AS profile_status,
          p.source_upload_url AS profile_source_upload_url,
          p.source_task_id AS profile_source_task_id,
          p.source_audio_id AS profile_source_audio_id,
          p.model AS profile_model,
          p.consent_scope AS profile_consent_scope,
          p.metadata_json AS profile_metadata_json,
          p.last_error AS profile_last_error,
          p.created_at AS profile_created_at,
          p.updated_at AS profile_updated_at,
          p.activated_at AS profile_activated_at,
          p.deleted_at AS profile_deleted_at,
          vp.status AS voice_profile_status,
          es.id AS session_id,
          es.user_id AS session_user_id,
          es.access_token AS session_access_token,
          es.consent_version AS session_consent_version,
          es.consent_scopes AS session_consent_scopes
        FROM voice_provider_jobs j
        LEFT JOIN voice_provider_profiles p ON p.id = ?
        LEFT JOIN voice_profiles vp ON vp.id = p.voice_profile_id AND vp.user_id = p.user_id
        LEFT JOIN enrollment_sessions es ON es.id = ?
        WHERE j.id = ?`,
      )
      .get(providerProfileId, sessionId || "__missing_session__", jobId);
    return mapVoiceProviderJobExecutionContext(row);
  }

  async function insertVoiceProviderJob({
    id,
    voiceProfileId,
    userId,
    provider,
    voiceProviderProfileId,
    status,
    step,
    maxAttempts,
    stepDataJson,
    createdAt,
    updatedAt,
  }) {
    return db
      .prepare(
        `INSERT INTO voice_provider_jobs (
        id, voice_profile_id, user_id, provider, voice_provider_profile_id,
        status, step, attempts, max_attempts, step_data, next_attempt_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        voiceProfileId,
        userId,
        provider,
        voiceProviderProfileId || null,
        status,
        step,
        maxAttempts,
        stepDataJson,
        createdAt,
        updatedAt,
      );
  }

  async function listDueVoiceProviderJobs({
    provider,
    status,
    now,
    limit,
  }) {
    return db
      .prepare(
        `SELECT *
           FROM voice_provider_jobs
          WHERE status = ?
            AND provider = ?
            AND attempts < max_attempts
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY updated_at ASC, created_at ASC
          LIMIT ?`,
      )
      .all(status, provider, now, limit);
  }

  async function markVoiceProviderJobRunning({
    id,
    status,
    pendingStatus,
    lockedAt,
    lockedBy,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_jobs
          SET status = ?, attempts = attempts + 1, locked_at = ?, locked_by = ?,
              last_error = NULL, updated_at = ?
        WHERE id = ?
          AND status = ?
          AND attempts < max_attempts`,
      )
      .run(status, lockedAt, lockedBy || null, updatedAt, id, pendingStatus);
  }

  async function heartbeatVoiceProviderJob({
    id,
    lockedBy,
    runningStatus,
    lockedAt,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_jobs
            SET locked_at = ?
          WHERE id = ?
            AND locked_by = ?
            AND status = ?`,
      )
      .run(lockedAt, id, lockedBy, runningStatus);
    return resultChanges(result);
  }

  async function markVoiceProviderJobStep({
    id,
    step,
    runningStatus,
    updatedAt,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_jobs
          SET step = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
      )
      .run(step, updatedAt, id, runningStatus);
    return resultChanges(result);
  }

  async function markTerminalStaleVoiceProviderJobs({
    status,
    lastError,
    updatedAt,
    runningStatus,
    provider,
    staleBefore,
    terminalStep,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_jobs
          SET status = ?, last_error = ?, locked_at = NULL, locked_by = NULL,
              next_attempt_at = NULL, updated_at = ?
        WHERE status = ?
          AND provider = ?
          AND locked_at IS NOT NULL
          AND locked_at < ?
          AND (attempts >= max_attempts OR step = ?)`,
      )
      .run(status, lastError, updatedAt, runningStatus, provider, staleBefore, terminalStep);
    return resultChanges(result);
  }

  async function markRetryableStaleVoiceProviderJobs({
    status,
    nextAttemptAt,
    updatedAt,
    runningStatus,
    provider,
    staleBefore,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_jobs
          SET status = ?, locked_at = NULL, locked_by = NULL,
              next_attempt_at = ?, updated_at = ?
        WHERE status = ?
          AND provider = ?
          AND locked_at IS NOT NULL
          AND locked_at < ?
          AND attempts < max_attempts`,
      )
      .run(status, nextAttemptAt, updatedAt, runningStatus, provider, staleBefore);
    return resultChanges(result);
  }

  async function failProviderProfilesForTerminalJobs({
    status,
    lastError,
    updatedAt,
    provider,
    failedJobStatus,
    inProgressStatuses,
    activeJobStatuses,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_profiles
            SET status = ?, last_error = ?, updated_at = ?
          WHERE deleted_at IS NULL
            AND status IN (${placeholders(inProgressStatuses)})
            AND id IN (
              SELECT voice_provider_profile_id FROM voice_provider_jobs
               WHERE provider = ? AND status = ? AND voice_provider_profile_id IS NOT NULL
            )
            AND id NOT IN (
              SELECT voice_provider_profile_id FROM voice_provider_jobs
               WHERE status IN (${placeholders(activeJobStatuses)})
                 AND voice_provider_profile_id IS NOT NULL
            )`,
      )
      .run(
        status,
        lastError,
        updatedAt,
        ...inProgressStatuses,
        provider,
        failedJobStatus,
        ...activeJobStatuses,
      );
  }

  async function markVoiceProviderJobCompleted({
    id,
    status,
    step,
    stepDataJson,
    completedAt,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_jobs
          SET status = ?, step = ?, step_data = COALESCE(?, step_data),
              completed_at = ?, locked_at = NULL, locked_by = NULL,
              updated_at = ?
        WHERE id = ?`,
      )
      .run(status, step, stepDataJson, completedAt, updatedAt, id);
  }

  async function updateVoiceProviderJobFailed({
    id,
    status,
    step,
    lastError,
    nextAttemptAt,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE voice_provider_jobs
          SET status = ?, step = COALESCE(?, step), last_error = ?,
              next_attempt_at = ?, locked_at = NULL, locked_by = NULL,
              updated_at = ?
        WHERE id = ?`,
      )
      .run(status, step || null, lastError, nextAttemptAt, updatedAt, id);
  }

  async function resetProviderProfileSourceAudioForRetry({
    id,
    status,
    lastError,
    metadataJson,
    updatedAt,
    allowedStatuses,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_profiles
            SET status = ?, source_audio_id = NULL, last_error = ?,
                metadata_json = ?, updated_at = ?
          WHERE id = ?
            AND deleted_at IS NULL
            AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(status, lastError, metadataJson, updatedAt, id, ...allowedStatuses);
    return resultChanges(result);
  }

  async function resetProviderProfileFreshCoverForRetry({
    id,
    status,
    lastError,
    metadataJson,
    updatedAt,
    allowedStatuses,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_profiles
            SET status = ?, source_task_id = NULL, source_audio_id = NULL,
                source_upload_url = NULL, last_error = ?, metadata_json = ?,
                updated_at = ?
          WHERE id = ?
            AND deleted_at IS NULL
            AND status IN (${placeholders(allowedStatuses)})`,
      )
      .run(status, lastError, metadataJson, updatedAt, id, ...allowedStatuses);
    return resultChanges(result);
  }

  async function cancelVoiceProviderJobsForVoiceProfile({
    voiceProfileId,
    userId,
    status,
    lastError,
    cancellationRequestedAt,
    cancelledAt,
    updatedAt,
    cancellableStatuses,
  }) {
    const result = await db
      .prepare(
        `UPDATE voice_provider_jobs
          SET status = ?, last_error = ?, locked_at = NULL, locked_by = NULL,
              cancellation_requested_at = ?, cancelled_at = ?, updated_at = ?
        WHERE voice_profile_id = ?
          AND user_id = ?
          AND status IN (${placeholders(cancellableStatuses)})`,
      )
      .run(
        status,
        lastError,
        cancellationRequestedAt,
        cancelledAt,
        updatedAt,
        voiceProfileId,
        userId,
        ...cancellableStatuses,
      );
    return resultChanges(result);
  }

  async function deleteVoiceProviderJobsForUser({ userId }) {
    const result = await db
      .prepare("DELETE FROM voice_provider_jobs WHERE user_id = ?")
      .run(userId);
    return resultChanges(result);
  }

  return {
    cancelVoiceProviderJobsForVoiceProfile,
    deleteVoiceProviderJobsForUser,
    failProviderProfilesForTerminalJobs,
    findActiveProviderProfileForUser,
    findActiveVoiceProfileForUser,
    findActiveVoiceProfileIdForUser,
    findVoiceProfileStatus,
    findDeletableVoiceProfileForUser,
    findLatestPendingProviderProfileForUser,
    findLatestNonDeletedVoiceProfileForUser,
    findLatestProviderProfileForVoiceProfile,
    getVoiceProviderJobExecutionContext,
    getLatestVoiceProviderJobForProfile,
    getProviderProfileById,
    getVoiceProviderJobById,
    hasActiveVoiceProfileForUser,
    heartbeatVoiceProviderJob,
    insertAuditLog,
    insertProviderProfile,
    insertVoiceProviderJob,
    listDueVoiceProviderJobs,
    listOlderActiveVoiceProfilesForUser,
    listProviderProfilesForUser,
    listProviderProfilesForVoiceProfile,
    markRetryableStaleVoiceProviderJobs,
    markTerminalStaleVoiceProviderJobs,
    markVoiceProfileActive,
    markVoiceProfileDeleted,
    markVoiceProviderJobCompleted,
    markVoiceProviderJobRunning,
    markVoiceProviderJobStep,
    softDeleteProviderProfilesForVoiceProfile,
    softDeleteProviderProfilesForUser,
    resetProviderProfileFreshCoverForRetry,
    resetProviderProfileSourceAudioForRetry,
    updateProviderProfileActive,
    updateProviderProfileCoverSubmitted,
    updateProviderProfileFailed,
    updateProviderProfileMetadata,
    updateProviderProfilePersonaSubmitted,
    updateProviderProfileUploadSubmitted,
    updateVoiceProviderJobFailed,
  };
}

module.exports = {
  createVoiceProviderProfileRepository,
};
