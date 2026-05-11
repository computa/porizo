const { generatePrefixedId } = require("../utils/ids");
const { parseJson } = require("../utils/common");

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

async function getProviderProfileById(db, id) {
  return db
    .prepare("SELECT * FROM voice_provider_profiles WHERE id = ?")
    .get(id);
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
  await db
    .prepare(
      `INSERT INTO voice_provider_profiles (
      id, voice_profile_id, user_id, provider, status, consent_scope,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      requireField(voiceProfileId, "voiceProfileId"),
      requireField(userId, "userId"),
      normalizedProvider,
      STATUS.PENDING,
      consentScope || null,
      toJson(metadata),
      createdAt,
      createdAt,
    );
  return getProviderProfileById(db, id);
}

async function findLatestProviderProfileForVoiceProfile(
  db,
  { voiceProfileId, provider = DEFAULT_PROVIDER, includeDeleted = false } = {},
) {
  const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
  return db
    .prepare(
      `SELECT * FROM voice_provider_profiles
     WHERE voice_profile_id = ? AND provider = ? ${deletedClause}
     ORDER BY created_at DESC
     LIMIT 1`,
    )
    .get(
      requireField(voiceProfileId, "voiceProfileId"),
      normalizeProvider(provider),
    );
}

async function findActiveProviderProfileForUser(
  db,
  { userId, provider = DEFAULT_PROVIDER } = {},
) {
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
    .get(requireField(userId, "userId"), normalizeProvider(provider));
}

async function findLatestPendingProviderProfileForUser(
  db,
  { userId, provider = DEFAULT_PROVIDER } = {},
) {
  return db
    .prepare(
      `SELECT vpp.*
       FROM voice_provider_profiles vpp
       JOIN voice_profiles vp
         ON vp.id = vpp.voice_profile_id
        AND vp.user_id = vpp.user_id
      WHERE vpp.user_id = ?
        AND vpp.provider = ?
        AND vpp.status IN ('pending', 'upload_submitted', 'cover_submitted', 'persona_submitted', 'failed', 'manual_cleanup_required')
        AND vpp.deleted_at IS NULL
        AND vp.deleted_at IS NULL
      ORDER BY vpp.created_at DESC
      LIMIT 1`,
    )
    .get(requireField(userId, "userId"), normalizeProvider(provider));
}

async function getLatestVoiceProviderJobForProfile(db, providerProfileId) {
  if (!providerProfileId) {
    return null;
  }
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

async function patchProviderProfileMetadata(db, id, patch = {}, error = null) {
  const existing = await getProviderProfileById(db, id);
  if (!existing) {
    return null;
  }
  const metadata = parseJson(existing.metadata_json, {}, "metadata_json") || {};
  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE voice_provider_profiles
          SET metadata_json = ?, last_error = COALESCE(?, last_error),
              updated_at = ?
        WHERE id = ?`,
    )
    .run(
      JSON.stringify({ ...metadata, ...patch }),
      error ? sanitizeProviderError(error) : null,
      updatedAt,
      requireField(id, "id"),
    );
  return getProviderProfileById(db, id);
}

async function retireOlderActiveVoiceProfilesForUser(
  db,
  { userId, activeVoiceProfileId, provider = DEFAULT_PROVIDER } = {},
) {
  const normalizedProvider = normalizeProvider(provider);
  const updatedAt = nowIso();
  const oldProfiles = await db
    .prepare(
      `SELECT id
         FROM voice_profiles
        WHERE user_id = ?
          AND status = 'active'
          AND id != ?
          AND deleted_at IS NULL`,
    )
    .all(
      requireField(userId, "userId"),
      requireField(activeVoiceProfileId, "activeVoiceProfileId"),
    );

  for (const profile of oldProfiles) {
    await softDeleteProviderProfilesForVoiceProfile(db, {
      voiceProfileId: profile.id,
      userId,
      provider: normalizedProvider,
      reason: "voice_profile_replaced",
    });
    await db
      .prepare(
        "UPDATE voice_profiles SET status = ?, deleted_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(STATUS.DELETED, updatedAt, profile.id, userId);
  }

  return oldProfiles.length;
}

async function markProviderProfileUploadSubmitted(
  db,
  id,
  { sourceUploadUrl, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_profiles
        SET status = ?, source_upload_url = ?, metadata_json = COALESCE(?, metadata_json),
            last_error = NULL, updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
        AND status IN ('pending', 'upload_submitted')`,
    )
    .run(
      STATUS.UPLOAD_SUBMITTED,
      sourceUploadUrl || null,
      toJson(metadata),
      updatedAt,
      requireField(id, "id"),
    );
  if (!result?.changes) {
    throw new Error("VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: upload_submitted");
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfileCoverSubmitted(
  db,
  id,
  { sourceTaskId, model = null, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_profiles
        SET status = ?, source_task_id = ?,
            model = COALESCE(?, model),
            metadata_json = COALESCE(?, metadata_json), last_error = NULL,
            updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
        AND status IN ('upload_submitted', 'cover_submitted')`,
    )
    .run(
      // U9: store COVER_SUBMITTED (was UPLOAD_SUBMITTED — wrong status for
      // the cover-generation stage of the state machine).
      STATUS.COVER_SUBMITTED,
      requireField(sourceTaskId, "sourceTaskId"),
      model || null,
      toJson(metadata),
      updatedAt,
      requireField(id, "id"),
    );
  if (!result?.changes) {
    throw new Error("VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: cover_submitted");
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfilePersonaSubmitted(
  db,
  id,
  { sourceTaskId, sourceAudioId, model = null, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_profiles
        SET status = ?, source_task_id = ?, source_audio_id = ?, source_upload_url = NULL, model = ?,
            metadata_json = COALESCE(?, metadata_json), last_error = NULL, updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
        AND status IN ('cover_submitted', 'persona_submitted')`,
    )
    .run(
      STATUS.PERSONA_SUBMITTED,
      requireField(sourceTaskId, "sourceTaskId"),
      requireField(sourceAudioId, "sourceAudioId"),
      model || null,
      toJson(metadata),
      updatedAt,
      requireField(id, "id"),
    );
  if (!result?.changes) {
    throw new Error("VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: persona_submitted");
  }
  return getProviderProfileById(db, id);
}

async function markProviderProfileActive(
  db,
  id,
  { providerProfileId, model = null, metadata = null } = {},
) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_profiles
        SET status = ?, provider_profile_id = ?, model = COALESCE(?, model),
            metadata_json = COALESCE(?, metadata_json), last_error = NULL,
            activated_at = ?, updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
        AND status IN ('persona_submitted', 'active')`,
    )
    .run(
      STATUS.ACTIVE,
      requireField(providerProfileId, "providerProfileId"),
      model || null,
      toJson(metadata),
      updatedAt,
      updatedAt,
      requireField(id, "id"),
    );
  if (!result?.changes) {
    throw new Error("VOICE_PROVIDER_PROFILE_INVALID_TRANSITION: active");
  }
  const active = await getProviderProfileById(db, id);
  if (active?.voice_profile_id && active?.user_id) {
    await db
      .prepare(
        `UPDATE voice_profiles
            SET status = 'active', last_verified_at = COALESCE(last_verified_at, ?)
          WHERE id = ?
            AND user_id = ?
            AND status IN ('pending_provider', 'active')`,
      )
      .run(updatedAt, active.voice_profile_id, active.user_id);
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
  const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
  await db
    .prepare(
      `UPDATE voice_provider_profiles
        SET status = ?, provider_profile_id = COALESCE(?, provider_profile_id),
            last_error = ?, metadata_json = COALESCE(?, metadata_json),
            updated_at = ?
      WHERE id = ? ${deletedClause}`,
    )
    .run(
      status,
      providerProfileId || null,
      sanitizeProviderError(error),
      toJson(metadata),
      updatedAt,
      requireField(id, "id"),
    );
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
      await db
        .prepare(
          "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          generatePrefixedId("aud", 12),
          profile.user_id || null,
          "voice_provider_manual_cleanup_required",
          "voice_provider_profile",
          profile.id,
          toJson({
            provider: profile.provider,
            provider_profile_id: providerProfileId || profile.provider_profile_id,
            error: sanitizeProviderError(
              error || "remote_persona_manual_cleanup_required",
            ),
            metadata,
          }),
          nowIso(),
        );
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
  const params = [
    STATUS.DELETED,
    String(reason || "deleted").slice(0, 1000),
    updatedAt,
    updatedAt,
    requireField(voiceProfileId, "voiceProfileId"),
    requireField(userId, "userId"),
  ];
  let providerClause = "";
  if (normalizedProvider) {
    providerClause = "AND provider = ?";
    params.push(normalizedProvider);
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
  return result?.changes || 0;
}

async function getVoiceProviderJobById(db, id) {
  return db.prepare("SELECT * FROM voice_provider_jobs WHERE id = ?").get(id);
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
  await db
    .prepare(
      `INSERT INTO voice_provider_jobs (
      id, voice_profile_id, user_id, provider, voice_provider_profile_id, status,
      step, attempts, max_attempts, step_data, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      requireField(voiceProfileId, "voiceProfileId"),
      requireField(userId, "userId"),
      normalizeProvider(provider),
      voiceProviderProfileId || null,
      STATUS.PENDING,
      step || "prepare_persona",
      Math.max(1, Number(maxAttempts) || 3),
      toJson(stepData),
      createdAt,
      createdAt,
    );
  return getVoiceProviderJobById(db, id);
}

async function markVoiceProviderJobRunning(db, id, { lockedBy = null } = {}) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_jobs
        SET status = ?, attempts = attempts + 1, locked_at = ?, locked_by = ?,
            last_error = NULL, updated_at = ?
      WHERE id = ?
        AND status = ?
        AND attempts < max_attempts`,
    )
    .run(
      "running",
      updatedAt,
      lockedBy || null,
      updatedAt,
      requireField(id, "id"),
      STATUS.PENDING,
    );
  if (!result?.changes) {
    return null;
  }
  return getVoiceProviderJobById(db, id);
}

async function markVoiceProviderJobStep(db, id, step) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_jobs
        SET step = ?, updated_at = ?
      WHERE id = ? AND status = ?`,
    )
    .run(step, updatedAt, requireField(id, "id"), "running");
  return result?.changes ?? result?.rowCount ?? 0;
}

async function recoverStaleVoiceProviderJobs(
  db,
  { staleBefore, provider = DEFAULT_PROVIDER } = {},
) {
  const updatedAt = nowIso();
  const terminal = await db
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
    .run(
      STATUS.FAILED,
      "E302_SUNO_PERSONA_MANUAL_RECOVERY_REQUIRED: stale job stopped after persona generation may have been submitted",
      updatedAt,
      "running",
      normalizeProvider(provider),
      staleBefore || updatedAt,
      "generate_persona",
    );
  const retryable = await db
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
    .run(
      STATUS.PENDING,
      updatedAt,
      updatedAt,
      "running",
      normalizeProvider(provider),
      staleBefore || updatedAt,
    );
  return (terminal?.changes || 0) + (retryable?.changes || 0);
}

async function markVoiceProviderJobCompleted(
  db,
  id,
  { step = "completed", stepData = null } = {},
) {
  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE voice_provider_jobs
        SET status = ?, step = ?, step_data = COALESCE(?, step_data),
            completed_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      "completed",
      step || "completed",
      toJson(stepData),
      updatedAt,
      updatedAt,
      requireField(id, "id"),
    );
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
  await db
    .prepare(
      `UPDATE voice_provider_jobs
        SET status = ?, step = COALESCE(?, step), last_error = ?,
            next_attempt_at = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      status,
      step || null,
      sanitizeProviderError(error),
      nextAttemptAt,
      updatedAt,
      requireField(id, "id"),
    );
  return getVoiceProviderJobById(db, id);
}

async function cancelVoiceProviderJobsForVoiceProfile(
  db,
  { voiceProfileId, userId, reason = "voice_profile_deleted" } = {},
) {
  const updatedAt = nowIso();
  const result = await db
    .prepare(
      `UPDATE voice_provider_jobs
        SET status = ?, last_error = ?, locked_at = NULL, locked_by = NULL,
            cancellation_requested_at = ?, cancelled_at = ?, updated_at = ?
      WHERE voice_profile_id = ?
        AND user_id = ?
        AND status IN ('pending', 'running')`,
    )
    .run(
      STATUS.CANCELLED,
      sanitizeProviderError(reason),
      updatedAt,
      updatedAt,
      updatedAt,
      requireField(voiceProfileId, "voiceProfileId"),
      requireField(userId, "userId"),
    );
  return result?.changes || 0;
}

module.exports = {
  STATUS,
  createPendingProviderProfile,
  findLatestProviderProfileForVoiceProfile,
  findLatestPendingProviderProfileForUser,
  findActiveProviderProfileForUser,
  getLatestVoiceProviderJobForProfile,
  getProviderProfileById,
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
  recoverStaleVoiceProviderJobs,
  cancelVoiceProviderJobsForVoiceProfile,
};
