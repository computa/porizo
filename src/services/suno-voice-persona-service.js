const path = require("path");
const {
  generatePersona,
  pollUploadCoverForAudio,
  submitUploadCoverTask,
  uploadFileUrl,
} = require("../providers/suno-persona");
const { resolveSunoCallbackUrl } = require("../providers/suno");
const {
  getProviderProfileById,
  getVoiceProviderJobById,
  markProviderProfileActive,
  markProviderProfileCoverSubmitted,
  markProviderProfileFailed,
  markProviderProfileManualCleanupRequired,
  markProviderProfilePersonaSubmitted,
  markProviderProfileUploadSubmitted,
  markVoiceProviderJobCompleted,
  markVoiceProviderJobFailed,
  markVoiceProviderJobRunning,
  markVoiceProviderJobStep,
} = require("./voice-provider-profile-service");
const { sanitizeProviderError } = require("../utils/provider-sanitize");
const { parseJson } = require("../utils/common");
const { generatePrefixedId } = require("../utils/ids");
const { sleep } = require("../utils/polling");
const {
  getEnrollmentSession,
  revokeEnrollmentSessionToken,
} = require("./enrollment-session-service");

const REQUIRED_CONSENT_SCOPE = "voice_suno_persona_v1";

/**
 * U2: Returns true if the provided scope string grants voice-persona consent.
 *
 * Accepts JSON array, JSON object with `.scopes`, or plain delimited string.
 * Used by call sites that read `voice_provider_profiles.consent_scope` (the
 * canonical scope-string format).
 *
 * IMPORTANT: This function MUST NOT be called with `enrollment_sessions.consent_version`
 * (e.g., "1.0") — that is a semver version, not a scope. Use
 * `enrollmentSessionHasPersonaConsent(session)` for session-level consent.
 */
function hasPersonaConsentScope(consentScope) {
  if (typeof consentScope !== "string") {
    return false;
  }
  const normalized = consentScope.trim();
  if (!normalized) {
    return false;
  }
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed.includes(REQUIRED_CONSENT_SCOPE);
    }
    if (Array.isArray(parsed?.scopes)) {
      return parsed.scopes.includes(REQUIRED_CONSENT_SCOPE);
    }
  } catch (_err) {
    // Plain delimited strings handled below.
  }
  return normalized
    .split(/[,\s+;|]+/)
    .filter(Boolean)
    .includes(REQUIRED_CONSENT_SCOPE);
}

/**
 * U2: Returns true if the enrollment session has recorded consent for the
 * Suno-persona scope.
 *
 * Reads `session.consent_scopes` (added by migration 098). Returns false when
 * the column is null/missing — fail-secure. Does NOT examine `consent_version`
 * (semver, not scope).
 */
function enrollmentSessionHasPersonaConsent(session) {
  if (!session || typeof session !== "object") {
    return false;
  }
  return hasPersonaConsentScope(session.consent_scopes);
}

function buildEnrollmentCleanAudioUrl({ baseUrl, sessionId, accessToken }) {
  const origin = typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : "";
  if (!origin || !sessionId || !accessToken) {
    return null;
  }
  return `${origin}/enrollment/${encodeURIComponent(sessionId)}/clean.wav?token=${encodeURIComponent(accessToken)}`;
}

function buildPersonaName() {
  return `porizo_voice_${generatePrefixedId("sp", 8)}`;
}

function buildPersonaDescription() {
  return "User-consented Porizo voice persona seed for personalized original songs.";
}

async function assertProviderJobReady({ db, job, providerProfile, session }) {
  if (!job) {
    throw new Error("E302_SUNO_PERSONA_JOB_NOT_FOUND");
  }
  if (!providerProfile) {
    throw new Error("E302_SUNO_PERSONA_PROFILE_NOT_FOUND");
  }
  if (job.status === "cancelled") {
    throw new Error("E302_SUNO_PERSONA_JOB_CANCELLED");
  }
  if (job.cancellation_requested_at) {
    throw new Error("E302_SUNO_PERSONA_JOB_CANCELLED");
  }
  if (providerProfile.provider !== "suno") {
    throw new Error("E302_SUNO_PERSONA_INVALID_PROVIDER");
  }
  if (providerProfile.deleted_at || providerProfile.status === "deleted") {
    throw new Error("E302_SUNO_PERSONA_PROFILE_DELETED");
  }
  if (providerProfile.status === "failed") {
    throw new Error("E302_SUNO_PERSONA_PROFILE_FAILED");
  }
  if (providerProfile.status === "manual_cleanup_required") {
    throw new Error("E302_SUNO_PERSONA_MANUAL_RECOVERY_REQUIRED");
  }
  if (
    providerProfile.user_id !== job.user_id ||
    providerProfile.voice_profile_id !== job.voice_profile_id
  ) {
    throw new Error("E302_SUNO_PERSONA_PROFILE_JOB_MISMATCH");
  }
  let voiceProfileStatus = providerProfile.voice_profile_status;
  if (voiceProfileStatus === undefined) {
    const voiceProfile = await db
      .prepare(
        "SELECT id, status FROM voice_profiles WHERE id = ? AND user_id = ?",
      )
      .get(providerProfile.voice_profile_id, providerProfile.user_id);
    voiceProfileStatus = voiceProfile?.status || null;
  }
  if (voiceProfileStatus !== "active") {
    throw new Error("E302_SUNO_PERSONA_VOICE_PROFILE_NOT_ACTIVE");
  }
  // U2: Honest two-arm check — profile scope OR session scope, never falling
  // back to consent_version (which is a semver, not a scope).
  const profileGranted = hasPersonaConsentScope(providerProfile.consent_scope);
  const sessionGranted = enrollmentSessionHasPersonaConsent(session);
  if (!profileGranted && !sessionGranted) {
    throw new Error("E302_SUNO_PERSONA_CONSENT_REQUIRED");
  }
}

// Re-fetches the three rows that gate persona-job execution and asserts they
// still permit the job to continue. Called between every step so cancellation,
// deletion, or consent revocation propagates within one step.
async function assertProviderJobStillAllowed({
  db,
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
  const currentJob = row
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
  const currentProfile = row?.profile_id
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
  const currentSession = row?.session_id
    ? {
        id: row.session_id,
        user_id: row.session_user_id,
        access_token: row.session_access_token,
        consent_version: row.session_consent_version,
        consent_scopes: row.session_consent_scopes,
      }
    : null;
  await assertProviderJobReady({
    db,
    job: currentJob,
    providerProfile: currentProfile,
    session: currentSession,
  });
  return {
    job: currentJob,
    providerProfile: currentProfile,
    session: currentSession,
  };
}

function isPermanentPersonaError(error) {
  const message = String(error?.message || error || "");
  return [
    "CONSENT_REQUIRED",
    "PROFILE_DELETED",
    "PROFILE_FAILED",
    "PROFILE_JOB_MISMATCH",
    "VOICE_PROFILE_NOT_ACTIVE",
    "INVALID_PROVIDER",
    "JOB_CANCELLED",
    "MANUAL_RECOVERY_REQUIRED",
  ].some((code) => message.includes(code));
}

function isRetryableGeneratePersonaReadinessError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("music does not exist") ||
    message.includes("music is still generating") ||
    message.includes("ensure the music generation task is fully completed") ||
    message.includes("create persona error")
  );
}

async function generatePersonaWithReadinessRetry({
  generatePersonaFn,
  personaArgs,
  maxAttempts = 8,
  delayMs = 15000,
  sleepFn = sleep,
} = {}) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  const waitMs = Math.max(0, Number(delayMs) || 0);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await generatePersonaFn(personaArgs);
    } catch (err) {
      if (
        attempt >= attempts ||
        !isRetryableGeneratePersonaReadinessError(err)
      ) {
        throw err;
      }
      console.warn(
        `[SunoPersona] generate-persona readiness retry ${attempt}/${attempts}: ${sanitizeProviderError(err)}`,
      );
      await sleepFn(waitMs);
    }
  }

  throw new Error("E302_SUNO_PERSONA_ERROR: generate-persona retry exhausted");
}

function buildPersonaVocalWindow(stepData = {}, audioDurationSec = null) {
  let start =
    typeof stepData.vocal_start === "number" && Number.isFinite(stepData.vocal_start)
      ? Math.max(0, stepData.vocal_start)
      : 0;
  let end =
    typeof stepData.vocal_end === "number" && Number.isFinite(stepData.vocal_end)
      ? stepData.vocal_end
      : start + 30;

  const audioDuration = Number(audioDurationSec);
  if (Number.isFinite(audioDuration) && audioDuration > 0) {
    if (audioDuration < 10) {
      return null;
    }
    start = Math.min(start, Math.max(0, audioDuration - 10));
    end = Math.min(end, audioDuration);
    if (end - start < 10) {
      end = Math.min(audioDuration, start + 20);
    }
    if (end - start < 10) {
      start = Math.max(0, audioDuration - Math.min(30, audioDuration));
      end = audioDuration;
    }
  }

  if (end - start > 30) {
    end = start + 30;
  }
  if (end - start < 10 || end <= start) {
    return null;
  }

  return {
    vocalStart: Number(start.toFixed(2)),
    vocalEnd: Number(end.toFixed(2)),
  };
}

async function runSunoVoicePersonaJob({
  db,
  jobId,
  config,
  lockedBy = "suno_voice_persona_worker",
  sunoClient = {
    uploadFileUrl,
    submitUploadCoverTask,
    pollUploadCoverForAudio,
    generatePersona,
  },
  pollingOptions = null,
} = {}) {
  let job = await markVoiceProviderJobRunning(db, jobId, { lockedBy });
  if (!job) {
    const currentJob = await getVoiceProviderJobById(db, jobId);
    throw new Error(
      `E302_SUNO_PERSONA_JOB_NOT_CLAIMED: status=${currentJob?.status || "missing"}`,
    );
  }
  const stepData = parseJson(job?.step_data, {});
  const providerProfileId =
    job?.voice_provider_profile_id || stepData.voice_provider_profile_id;
  let providerProfile = await getProviderProfileById(db, providerProfileId);
  // U3: cross-domain SQL moved into enrollment-session-service.
  let session = stepData.enrollment_session_id
    ? await getEnrollmentSession(db, stepData.enrollment_session_id)
    : null;
  let generatePersonaRequestStarted = false;

  try {
    await assertProviderJobReady({ db, job, providerProfile, session });
    if (
      providerProfile.provider_profile_id &&
      providerProfile.status === "active"
    ) {
      await markVoiceProviderJobCompleted(db, job.id, {
        step: "persona_active",
        stepData: {
          voice_provider_profile_id: providerProfile.id,
          provider: "suno",
          status: "active",
        },
      });
      return providerProfile;
    }
    const model = stepData.model || config.SUNO_MODEL || "V5_5";
    const audioWeight = stepData.audio_weight ?? 0.85;
    const sourceKey = stepData.source_audio_key || "";
    const fileName = sourceKey
      ? path.basename(sourceKey)
      : `${providerProfile.id}.wav`;
    let uploadUrl = providerProfile.source_upload_url;
    let sourceTaskId = providerProfile.source_task_id;
    if (!uploadUrl && !sourceTaskId) {
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
      const sourceUrl = buildEnrollmentCleanAudioUrl({
        baseUrl: config.PUBLIC_BASE_URL || config.STREAM_BASE_URL,
        sessionId: session?.id,
        accessToken: session?.access_token,
      });
      if (!sourceUrl) {
        throw new Error("E302_SUNO_PERSONA_SOURCE_URL_MISSING");
      }
      const upload = await sunoClient.uploadFileUrl({
        uploadBaseUrl: config.SUNO_FILE_UPLOAD_BASE_URL,
        apiKey: config.SUNO_API_KEY,
        fileUrl: sourceUrl,
        uploadPath: `porizo/voice-personas/${providerProfile.id}`,
        fileName,
        timeoutMs: config.PROVIDER_TIMEOUT_MS,
      });
      uploadUrl = upload.downloadUrl;
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
      await markProviderProfileUploadSubmitted(db, providerProfile.id, {
        sourceUploadUrl: upload.downloadUrl,
        metadata: {
          upload_file_name: upload.fileName,
          upload_mime_type: upload.mimeType,
          upload_file_size: upload.fileSize,
        },
      });
    }

    if (!sourceTaskId) {
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
      // U1: callBackUrl is required. Persona path fails fast when unset
      // (rather than silently leaking task metadata to httpbin.org).
      let callBackUrl = "";
      try {
        callBackUrl = resolveSunoCallbackUrl();
      } catch (_err) {
        throw new Error(
          "E302_SUNO_PERSONA_CALLBACK_NOT_CONFIGURED: SUNO_CALLBACK_URL must be set when persona feature is enabled",
        );
      }
      const cover = await sunoClient.submitUploadCoverTask({
        baseUrl: config.SUNO_BASE_URL,
        apiKey: config.SUNO_API_KEY,
        uploadUrl,
        model,
        audioWeight,
        callBackUrl,
        timeoutMs: config.PROVIDER_TIMEOUT_MS,
      });
      sourceTaskId = cover.taskId;
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
      await markProviderProfileCoverSubmitted(db, providerProfile.id, {
        sourceTaskId,
        model: cover.model,
      });
      // U3: token revocation post-cover-submit goes through enrollment-domain.
      await revokeEnrollmentSessionToken(db, session.id);
    }

    let sourceAudioId = providerProfile.source_audio_id;
    if (!sourceAudioId) {
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
      const audio = await sunoClient.pollUploadCoverForAudio({
        baseUrl: config.SUNO_BASE_URL,
        apiKey: config.SUNO_API_KEY,
        taskId: sourceTaskId,
        vocalStart: stepData.vocal_start,
        vocalEnd: stepData.vocal_end,
        timeoutMs: config.PROVIDER_TIMEOUT_MS,
        pollingOptions,
      });
      if (!audio?.audioId) {
        throw new Error(
          "E302_SUNO_PERSONA_AUDIO_NOT_READY: upload-cover polling ended without a ready audioId",
        );
      }
      sourceAudioId = audio.audioId;
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
      await markProviderProfilePersonaSubmitted(db, providerProfile.id, {
        sourceTaskId:
          audio.response?.data?.taskId ||
          audio.response?.data?.task_id ||
          sourceTaskId,
        sourceAudioId,
        model,
        metadata: {
          suno_source_audio_duration_sec: audio.audioDurationSec || null,
          suno_source_audio_track_index:
            typeof audio.audioTrackIndex === "number"
              ? audio.audioTrackIndex
              : null,
        },
      });
    }

    ({ providerProfile, session } = await assertProviderJobStillAllowed({
      db,
      jobId: job.id,
      providerProfileId: providerProfile.id,
      sessionId: session?.id,
    }));
    const stepClaimed = await markVoiceProviderJobStep(
      db,
      job.id,
      "generate_persona",
    );
    if (!stepClaimed) {
      throw new Error(
        "E302_SUNO_PERSONA_LOST_CLAIM: persona generation step could not be claimed",
      );
    }
    generatePersonaRequestStarted = true;
    // U14: vocalStart/vocalEnd thread through from enrollment-route's
    // step_data into the generate-persona payload. Pre-U14 these were
    // DEFAULTED in the payload builder (0/30); now the enrollment route
    // derives a sensible window from the user's clean audio metadata and
    // populates step_data so persona quality reflects the actual vocal range.
    // When unset, the payload builder's 10-30s validation falls back to
    // defaults (preserves original behavior for old jobs).
    const personaArgs = {
      baseUrl: config.SUNO_BASE_URL,
      apiKey: config.SUNO_API_KEY,
      taskId: sourceTaskId,
      audioId: sourceAudioId,
      name: buildPersonaName(),
      description: buildPersonaDescription(),
      style: "clean pop vocal, warm studio mix, clear lead vocal",
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
    };
    const personaWindow = buildPersonaVocalWindow(
      stepData,
      providerProfile.metadata_json
        ? parseJson(providerProfile.metadata_json, {})
            .suno_source_audio_duration_sec
        : null,
    );
    if (personaWindow) {
      personaArgs.vocalStart = personaWindow.vocalStart;
      personaArgs.vocalEnd = personaWindow.vocalEnd;
    }
    const persona = await generatePersonaWithReadinessRetry({
      generatePersonaFn: sunoClient.generatePersona,
      personaArgs,
      maxAttempts: config.SUNO_PERSONA_GENERATE_MAX_ATTEMPTS || 8,
      delayMs: config.SUNO_PERSONA_GENERATE_RETRY_DELAY_MS || 15000,
    });
    try {
      ({ providerProfile, session } = await assertProviderJobStillAllowed({
        db,
        jobId: job.id,
        providerProfileId: providerProfile.id,
        sessionId: session?.id,
      }));
    } catch (postPersonaErr) {
      await markProviderProfileManualCleanupRequired(db, providerProfile.id, {
        providerProfileId: persona.personaId,
        error: `E302_SUNO_PERSONA_MANUAL_CLEANUP_REQUIRED: ${postPersonaErr.message}`,
        metadata: {
          remote_persona_created_after_cancellation: true,
          persona_model: "voice_persona",
        },
      });
      throw postPersonaErr;
    }

    const active = await markProviderProfileActive(db, providerProfile.id, {
      providerProfileId: persona.personaId,
      model,
      metadata: {
        persona_name: persona.name,
        persona_model: "voice_persona",
      },
    });
    await markVoiceProviderJobCompleted(db, job.id, {
      step: "persona_active",
      stepData: {
        voice_provider_profile_id: active.id,
        provider: "suno",
        status: "active",
      },
    });
    return active;
  } catch (err) {
    const latestProfile = providerProfile?.id
      ? await getProviderProfileById(db, providerProfile.id)
      : null;
    if (
      latestProfile?.status === "active" &&
      latestProfile.provider_profile_id
    ) {
      await markVoiceProviderJobCompleted(db, job.id, {
        step: "persona_active",
        stepData: {
          voice_provider_profile_id: latestProfile.id,
          provider: "suno",
          status: "active",
        },
      }).catch(() => null);
      return latestProfile;
    }
    if (generatePersonaRequestStarted) {
      const retryableReadiness = isRetryableGeneratePersonaReadinessError(err);
      const manualRecoveryError = new Error(
        `E302_SUNO_PERSONA_MANUAL_RECOVERY_REQUIRED: ${sanitizeProviderError(err)}`,
      );
      const failedJob = await markVoiceProviderJobFailed(
        db,
        jobId,
        retryableReadiness ? err : manualRecoveryError,
        {
          step: "generate_persona",
          retryable: retryableReadiness,
        },
      );
      if (failedJob?.status === "failed" && session?.id) {
        // U3: token revocation on permanent failure (manual-recovery path).
        await revokeEnrollmentSessionToken(db, session.id);
      }
      if (providerProfile?.id && failedJob?.status === "failed") {
        await markProviderProfileFailed(
          db,
          providerProfile.id,
          manualRecoveryError,
        );
      }
      if (retryableReadiness) {
        throw new Error(sanitizeProviderError(err));
      }
      throw manualRecoveryError;
    }
    const failedJob = await markVoiceProviderJobFailed(db, jobId, err, {
      step: "prepare_persona",
      retryable: !isPermanentPersonaError(err),
    });
    if (failedJob?.status === "failed" && session?.id) {
      // U3: token revocation on permanent failure (prepare-step path).
      await revokeEnrollmentSessionToken(db, session.id);
    }
    if (providerProfile?.id && failedJob?.status === "failed") {
      await markProviderProfileFailed(db, providerProfile.id, err);
    }
    throw new Error(sanitizeProviderError(err));
  }
}

module.exports = {
  REQUIRED_CONSENT_SCOPE,
  buildEnrollmentCleanAudioUrl,
  generatePersonaWithReadinessRetry,
  hasPersonaConsentScope,
  enrollmentSessionHasPersonaConsent,
  isRetryableGeneratePersonaReadinessError,
  runSunoVoicePersonaJob,
};
