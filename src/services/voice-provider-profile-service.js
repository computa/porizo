const { generatePrefixedId } = require("../utils/ids");
const { parseJson } = require("../utils/common");
const {
  createVoiceProviderProfileRepository,
} = require("../database/voice-provider-profile-repository");

const DEFAULT_PROVIDER = "suno";
// U9: COVER_SUBMITTED added to distinguish file-upload submission from
// cover-generation submission. Pre-U9, `markProviderProfileCoverSubmitted`
// stored UPLOAD_SUBMITTED — collapsing two distinct stages into one observable
// state. New rows transition: pending → upload_submitted → cover_submitted →
// persona_submitted → active. Existing rows at upload_submitted stay there
// until their job re-runs (acceptable: feature is OFF in production).
const STATUS = Object.freeze({
  PENDING: "pending",
  UPLOAD_SUBMITTED: "upload_submitted",
  COVER_SUBMITTED: "cover_submitted",
  PERSONA_SUBMITTED: "persona_submitted",
  ACTIVE: "active",
  FAILED: "failed",
  MANUAL_CLEANUP_REQUIRED: "manual_cleanup_required",
  CANCELLED: "cancelled",
  DELETED: "deleted",
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeProvider(provider) {
  return typeof provider === "string" && provider.trim()
    ? provider.trim().toLowerCase()
    : DEFAULT_PROVIDER;
}

function toJson(value) {
  if (value == null) {
    return null;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

// U5: sanitize moved to src/utils/provider-sanitize.js. Re-export for
// backward compatibility with the original module's exports.
const { sanitizeProviderError } = require("../utils/provider-sanitize");

function requireField(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`VOICE_PROVIDER_PROFILE_INVALID: ${name} is required`);
  }
  return value.trim();
}

function repositoryFor(db) {
  return createVoiceProviderProfileRepository(db);
}

async function getProviderProfileById(db, id) {
  return repositoryFor(db).getProviderProfileById(id);
}

async function createPendingProviderProfile(
  db,
  {
    id = generatePrefixedId("vpp", 10),
    voiceProfileId,
    userId,
    provider = DEFAULT_PROVIDER,
    consentScope = null,
    metadata = null,
  } = {},
) {
  const createdAt = nowIso();
  const normalizedProvider = normalizeProvider(provider);
  await repositoryFor(db).insertProviderProfile({
    id,
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    userId: requireField(userId, "userId"),
    provider: normalizedProvider,
    status: STATUS.PENDING,
    consentScope: consentScope || null,
    metadataJson: toJson(metadata),
    createdAt,
    updatedAt: createdAt,
  });
  return getProviderProfileById(db, id);
}

async function findLatestProviderProfileForVoiceProfile(
  db,
  { voiceProfileId, provider = DEFAULT_PROVIDER, includeDeleted = false } = {},
) {
  return repositoryFor(db).findLatestProviderProfileForVoiceProfile({
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    provider: normalizeProvider(provider),
    includeDeleted,
  });
}

async function findActiveProviderProfileForUser(
  db,
  { userId, provider = DEFAULT_PROVIDER } = {},
) {
  return repositoryFor(db).findActiveProviderProfileForUser({
    userId: requireField(userId, "userId"),
    provider: normalizeProvider(provider),
  });
}

async function findLatestPendingProviderProfileForUser(
  db,
  { userId, provider = DEFAULT_PROVIDER } = {},
) {
  return repositoryFor(db).findLatestPendingProviderProfileForUser({
    userId: requireField(userId, "userId"),
    provider: normalizeProvider(provider),
    statuses: [
      STATUS.PENDING,
      STATUS.UPLOAD_SUBMITTED,
      STATUS.COVER_SUBMITTED,
      STATUS.PERSONA_SUBMITTED,
      STATUS.FAILED,
      STATUS.MANUAL_CLEANUP_REQUIRED,
    ],
  });
}

async function getLatestVoiceProviderJobForProfile(db, providerProfileId) {
  if (!providerProfileId) {
    return null;
  }
  return repositoryFor(db).getLatestVoiceProviderJobForProfile(
    providerProfileId,
  );
}

async function listProviderProfilesForVoiceProfile(
  db,
  { voiceProfileId, userId, includeDeleted = false } = {},
) {
  return repositoryFor(db).listProviderProfilesForVoiceProfile({
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    userId: requireField(userId, "userId"),
    includeDeleted,
  });
}

async function listProviderProfilesForUser(
  db,
  { userId, includeDeleted = false } = {},
) {
  return repositoryFor(db).listProviderProfilesForUser({
    userId: requireField(userId, "userId"),
    includeDeleted,
  });
}

async function patchProviderProfileMetadata(db, id, patch = {}, error = null) {
  const existing = await getProviderProfileById(db, id);
  if (!existing) {
    return null;
  }
  const metadata = parseJson(existing.metadata_json, {}, "metadata_json") || {};
  const updatedAt = nowIso();
  await repositoryFor(db).updateProviderProfileMetadata({
    id: requireField(id, "id"),
    metadataJson: JSON.stringify({ ...metadata, ...patch }),
    lastError: error ? sanitizeProviderError(error) : null,
    updatedAt,
  });
  return getProviderProfileById(db, id);
}

async function retireOlderActiveVoiceProfilesForUser(
  db,
  { userId, activeVoiceProfileId, provider = DEFAULT_PROVIDER } = {},
) {
  const normalizedProvider = normalizeProvider(provider);
  const updatedAt = nowIso();
  const oldProfiles = await repositoryFor(db).listOlderActiveVoiceProfilesForUser(
    {
      userId: requireField(userId, "userId"),
      activeVoiceProfileId: requireField(
        activeVoiceProfileId,
        "activeVoiceProfileId",
      ),
    },
  );

  for (const profile of oldProfiles) {
    await softDeleteProviderProfilesForVoiceProfile(db, {
      voiceProfileId: profile.id,
      userId,
      provider: normalizedProvider,
      reason: "voice_profile_replaced",
    });
    await repositoryFor(db).markVoiceProfileDeleted({
      id: profile.id,
      userId,
      status: STATUS.DELETED,
      deletedAt: updatedAt,
    });
  }

  return oldProfiles.length;
}

async function markProviderProfileUploadSubmitted(
  db,
  id,
  { sourceUploadUrl, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await repositoryFor(db).updateProviderProfileUploadSubmitted({
    id: requireField(id, "id"),
    status: STATUS.UPLOAD_SUBMITTED,
    sourceUploadUrl: sourceUploadUrl || null,
    metadataJson: toJson(metadata),
    updatedAt,
    allowedStatuses: [STATUS.PENDING, STATUS.UPLOAD_SUBMITTED],
  });
  if (!result?.changes) {
    throw new Error(
      "VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: upload_submitted",
    );
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfileCoverSubmitted(
  db,
  id,
  { sourceTaskId, model = null, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await repositoryFor(db).updateProviderProfileCoverSubmitted({
    id: requireField(id, "id"),
    // U9: store COVER_SUBMITTED (was UPLOAD_SUBMITTED -- wrong status for
    // the cover-generation stage of the state machine).
    status: STATUS.COVER_SUBMITTED,
    sourceTaskId: requireField(sourceTaskId, "sourceTaskId"),
    model: model || null,
    metadataJson: toJson(metadata),
    updatedAt,
    allowedStatuses: [STATUS.UPLOAD_SUBMITTED, STATUS.COVER_SUBMITTED],
  });
  if (!result?.changes) {
    throw new Error(
      "VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: cover_submitted",
    );
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfilePersonaSubmitted(
  db,
  id,
  { sourceTaskId, sourceAudioId, model = null, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await repositoryFor(db).updateProviderProfilePersonaSubmitted({
    id: requireField(id, "id"),
    status: STATUS.PERSONA_SUBMITTED,
    sourceTaskId: requireField(sourceTaskId, "sourceTaskId"),
    sourceAudioId: requireField(sourceAudioId, "sourceAudioId"),
    model: model || null,
    metadataJson: toJson(metadata),
    updatedAt,
    allowedStatuses: [STATUS.COVER_SUBMITTED, STATUS.PERSONA_SUBMITTED],
  });
  if (!result?.changes) {
    throw new Error(
      "VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: persona_submitted",
    );
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfileActive(
  db,
  id,
  { providerProfileId, model = null, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await repositoryFor(db).updateProviderProfileActive({
    id: requireField(id, "id"),
    status: STATUS.ACTIVE,
    providerProfileId: requireField(providerProfileId, "providerProfileId"),
    model: model || null,
    metadataJson: toJson(metadata),
    activatedAt: updatedAt,
    updatedAt,
    allowedStatuses: [STATUS.PERSONA_SUBMITTED, STATUS.ACTIVE],
  });
  if (!result?.changes) {
    throw new Error("VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: active");
  }
  const active = await getProviderProfileById(db, id);
  if (active?.voice_profile_id && active?.user_id) {
    await repositoryFor(db).markVoiceProfileActive({
      voiceProfileId: active.voice_profile_id,
      userId: active.user_id,
      lastVerifiedAt: updatedAt,
      allowedStatuses: ["pending_provider", STATUS.ACTIVE],
    });
    await retireOlderActiveVoiceProfilesForUser(db, {
      userId: active.user_id,
      activeVoiceProfileId: active.voice_profile_id,
      provider: active.provider,
    });
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfileFailed(
  db,
  id,
  error,
  {
    metadata = null,
    providerProfileId = null,
    includeDeleted = false,
    status = STATUS.FAILED,
  } = {},
) {
  const updatedAt = nowIso();
  await repositoryFor(db).updateProviderProfileFailed({
    id: requireField(id, "id"),
    status,
    providerProfileId: providerProfileId || null,
    lastError: sanitizeProviderError(error),
    metadataJson: toJson(metadata),
    updatedAt,
    includeDeleted,
  });
  return getProviderProfileById(db, id);
}

async function markProviderProfileManualCleanupRequired(
  db,
  id,
  { providerProfileId, error, metadata = null } = {},
) {
  const profile = await markProviderProfileFailed(
    db,
    id,
    error || "remote_persona_manual_cleanup_required",
    {
      providerProfileId,
      includeDeleted: true,
      metadata,
      status: STATUS.MANUAL_CLEANUP_REQUIRED,
    },
  );
  if (profile) {
    try {
      await repositoryFor(db).insertAuditLog({
        id: generatePrefixedId("aud", 12),
        userId: profile.user_id || null,
        action: "voice_provider_manual_cleanup_required",
        resourceType: "voice_provider_profile",
        resourceId: profile.id,
        metadataJson: toJson({
          provider: profile.provider,
          provider_profile_id: providerProfileId || profile.provider_profile_id,
          error: sanitizeProviderError(
            error || "remote_persona_manual_cleanup_required",
          ),
          metadata,
        }),
        createdAt: nowIso(),
      });
    } catch (_err) {
      // Best-effort audit trail; the profile status is the source of truth.
    }
  }
  return profile;
}

async function softDeleteProviderProfilesForVoiceProfile(
  db,
  {
    voiceProfileId,
    userId,
    provider = null,
    reason = "voice_profile_deleted",
  } = {},
) {
  const updatedAt = nowIso();
  const normalizedProvider = provider ? normalizeProvider(provider) : null;
  return repositoryFor(db).softDeleteProviderProfilesForVoiceProfile({
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    userId: requireField(userId, "userId"),
    provider: normalizedProvider,
    status: STATUS.DELETED,
    lastError: String(reason || "deleted").slice(0, 1000),
    deletedAt: updatedAt,
    updatedAt,
  });
}

async function softDeleteProviderProfilesForUser(
  db,
  { userId, reason = "account_deletion", deletedAt = nowIso() } = {},
) {
  return repositoryFor(db).softDeleteProviderProfilesForUser({
    userId: requireField(userId, "userId"),
    status: STATUS.DELETED,
    lastError: String(reason || "deleted").slice(0, 1000),
    deletedAt,
    updatedAt: deletedAt,
  });
}

async function getVoiceProviderJobById(db, id) {
  return repositoryFor(db).getVoiceProviderJobById(id);
}

async function findVoiceProfileStatus(db, { voiceProfileId, userId } = {}) {
  return repositoryFor(db).findVoiceProfileStatus({
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    userId: requireField(userId, "userId"),
  });
}

async function getVoiceProviderJobExecutionContext(
  db,
  { jobId, providerProfileId, sessionId = null } = {},
) {
  return repositoryFor(db).getVoiceProviderJobExecutionContext({
    jobId: requireField(jobId, "jobId"),
    providerProfileId: requireField(providerProfileId, "providerProfileId"),
    sessionId,
  });
}

async function createVoiceProviderJob(
  db,
  {
    id = generatePrefixedId("vpj", 10),
    voiceProfileId,
    userId,
    provider = DEFAULT_PROVIDER,
    voiceProviderProfileId = null,
    step = "prepare_persona",
    stepData = null,
    maxAttempts = 3,
  } = {},
) {
  const createdAt = nowIso();
  await repositoryFor(db).insertVoiceProviderJob({
    id,
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    userId: requireField(userId, "userId"),
    provider: normalizeProvider(provider),
    voiceProviderProfileId: voiceProviderProfileId || null,
    status: STATUS.PENDING,
    step: step || "prepare_persona",
    maxAttempts: Math.max(1, Number(maxAttempts) || 3),
    stepDataJson: toJson(stepData),
    createdAt,
    updatedAt: createdAt,
  });
  return getVoiceProviderJobById(db, id);
}

async function listDueVoiceProviderJobs(
  db,
  { provider = DEFAULT_PROVIDER, now = nowIso(), limit = 1 } = {},
) {
  return repositoryFor(db).listDueVoiceProviderJobs({
    provider: normalizeProvider(provider),
    status: STATUS.PENDING,
    now,
    limit: Math.max(0, Number(limit) || 0),
  });
}

async function markVoiceProviderJobRunning(db, id, { lockedBy = null } = {}) {
  const updatedAt = nowIso();
  const result = await repositoryFor(db).markVoiceProviderJobRunning({
    id: requireField(id, "id"),
    status: "running",
    pendingStatus: STATUS.PENDING,
    lockedAt: updatedAt,
    lockedBy: lockedBy || null,
    updatedAt,
  });
  if (!result?.changes) {
    return null;
  }
  return getVoiceProviderJobById(db, id);
}

async function heartbeatVoiceProviderJob(
  db,
  { id, lockedBy, runningStatus = "running" } = {},
) {
  return repositoryFor(db).heartbeatVoiceProviderJob({
    id: requireField(id, "id"),
    lockedBy: requireField(lockedBy, "lockedBy"),
    runningStatus,
    lockedAt: nowIso(),
  });
}

async function markVoiceProviderJobStep(db, id, step) {
  const updatedAt = nowIso();
  return repositoryFor(db).markVoiceProviderJobStep({
    id: requireField(id, "id"),
    step,
    runningStatus: "running",
    updatedAt,
  });
}

async function recoverStaleVoiceProviderJobs(
  db,
  { staleBefore, provider = DEFAULT_PROVIDER } = {},
) {
  const updatedAt = nowIso();
  const normalizedProvider = normalizeProvider(provider);
  const terminal = await repositoryFor(db).markTerminalStaleVoiceProviderJobs({
    status: STATUS.FAILED,
    lastError:
      "E302_SUNO_PERSONA_MANUAL_RECOVERY_REQUIRED: stale job stopped after persona generation may have been submitted",
    updatedAt,
    runningStatus: "running",
    provider: normalizedProvider,
    staleBefore: staleBefore || updatedAt,
    terminalStep: "generate_persona",
  });
  const retryable = await repositoryFor(db).markRetryableStaleVoiceProviderJobs({
    status: STATUS.PENDING,
    nextAttemptAt: updatedAt,
    updatedAt,
    runningStatus: "running",
    provider: normalizedProvider,
    staleBefore: staleBefore || updatedAt,
  });

  // Propagate terminal job failure to the provider profile so the user's
  // enrollment doesn't sit on "preparing" forever after a worker crash. Only
  // fail profiles still in an in-progress provider state, and NEVER one that
  // still has a queued/running retry (that would prematurely kill a valid
  // recovery). readiness then resolves to needs_recapture instead of preparing.
  await repositoryFor(db).failProviderProfilesForTerminalJobs({
    status: STATUS.FAILED,
    lastError:
      "E399_STALE_JOB_RECOVERY: provider job stalled and was failed by recovery sweep",
    updatedAt,
    provider: normalizedProvider,
    failedJobStatus: STATUS.FAILED,
    inProgressStatuses: [
      STATUS.PENDING,
      STATUS.UPLOAD_SUBMITTED,
      STATUS.COVER_SUBMITTED,
      STATUS.PERSONA_SUBMITTED,
    ],
    activeJobStatuses: [STATUS.PENDING, "running"],
  });

  return terminal + retryable;
}

async function markVoiceProviderJobCompleted(
  db,
  id,
  { step = "completed", stepData = null } = {},
) {
  const updatedAt = nowIso();
  await repositoryFor(db).markVoiceProviderJobCompleted({
    id: requireField(id, "id"),
    status: "completed",
    step: step || "completed",
    stepDataJson: toJson(stepData),
    completedAt: updatedAt,
    updatedAt,
  });
  return getVoiceProviderJobById(db, id);
}

function computeRetryAt(attempts) {
  const attemptNumber = Math.max(1, Number(attempts || 1));
  const delayMs = Math.min(15 * 60_000, 60_000 * 2 ** (attemptNumber - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

async function markVoiceProviderJobFailed(
  db,
  id,
  error,
  { retryable = true, step = null } = {},
) {
  const updatedAt = nowIso();
  const job = await getVoiceProviderJobById(db, requireField(id, "id"));
  if (job?.status === STATUS.CANCELLED) {
    return job;
  }
  const attempts = Number(job?.attempts || 0);
  const maxAttempts = Math.max(1, Number(job?.max_attempts || 1));
  const status =
    retryable && attempts < maxAttempts ? STATUS.PENDING : STATUS.FAILED;
  const nextAttemptAt =
    status === STATUS.PENDING ? computeRetryAt(attempts) : null;
  await repositoryFor(db).updateVoiceProviderJobFailed({
    id: requireField(id, "id"),
    status,
    step: step || null,
    lastError: sanitizeProviderError(error),
    nextAttemptAt,
    updatedAt,
  });
  return getVoiceProviderJobById(db, id);
}

async function resetProviderProfileSourceAudioForRetry(
  db,
  { id, error, metadata = null } = {},
) {
  await repositoryFor(db).resetProviderProfileSourceAudioForRetry({
    id: requireField(id, "id"),
    status: STATUS.COVER_SUBMITTED,
    lastError: sanitizeProviderError(error),
    metadataJson: toJson(metadata),
    updatedAt: nowIso(),
    allowedStatuses: [STATUS.PERSONA_SUBMITTED, STATUS.FAILED],
  });
  return getProviderProfileById(db, id);
}

async function resetProviderProfileFreshCoverForRetry(
  db,
  { id, error, metadata = null } = {},
) {
  await repositoryFor(db).resetProviderProfileFreshCoverForRetry({
    id: requireField(id, "id"),
    status: STATUS.UPLOAD_SUBMITTED,
    lastError: sanitizeProviderError(error),
    metadataJson: toJson(metadata),
    updatedAt: nowIso(),
    allowedStatuses: [
      STATUS.PERSONA_SUBMITTED,
      STATUS.COVER_SUBMITTED,
      STATUS.FAILED,
    ],
  });
  return getProviderProfileById(db, id);
}

async function cancelVoiceProviderJobsForVoiceProfile(
  db,
  { voiceProfileId, userId, reason = "voice_profile_deleted" } = {},
) {
  const updatedAt = nowIso();
  return repositoryFor(db).cancelVoiceProviderJobsForVoiceProfile({
    voiceProfileId: requireField(voiceProfileId, "voiceProfileId"),
    userId: requireField(userId, "userId"),
    status: STATUS.CANCELLED,
    lastError: sanitizeProviderError(reason),
    cancellationRequestedAt: updatedAt,
    cancelledAt: updatedAt,
    updatedAt,
    cancellableStatuses: [STATUS.PENDING, "running"],
  });
}

async function deleteVoiceProviderJobsForUser(db, { userId } = {}) {
  return repositoryFor(db).deleteVoiceProviderJobsForUser({
    userId: requireField(userId, "userId"),
  });
}

module.exports = {
  STATUS,
  createPendingProviderProfile,
  findLatestProviderProfileForVoiceProfile,
  findLatestPendingProviderProfileForUser,
  findActiveProviderProfileForUser,
  getLatestVoiceProviderJobForProfile,
  getProviderProfileById,
  findVoiceProfileStatus,
  getVoiceProviderJobExecutionContext,
  heartbeatVoiceProviderJob,
  listDueVoiceProviderJobs,
  listProviderProfilesForUser,
  listProviderProfilesForVoiceProfile,
  patchProviderProfileMetadata,
  markProviderProfileUploadSubmitted,
  markProviderProfileCoverSubmitted,
  markProviderProfilePersonaSubmitted,
  markProviderProfileActive,
  markProviderProfileFailed,
  markProviderProfileManualCleanupRequired,
  softDeleteProviderProfilesForVoiceProfile,
  createVoiceProviderJob,
  getVoiceProviderJobById,
  markVoiceProviderJobRunning,
  markVoiceProviderJobStep,
  markVoiceProviderJobCompleted,
  markVoiceProviderJobFailed,
  resetProviderProfileFreshCoverForRetry,
  resetProviderProfileSourceAudioForRetry,
  recoverStaleVoiceProviderJobs,
  cancelVoiceProviderJobsForVoiceProfile,
  deleteVoiceProviderJobsForUser,
  softDeleteProviderProfilesForUser,
};
