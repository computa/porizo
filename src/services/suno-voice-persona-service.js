const path = require("path");
const {
  generatePersona,
  pollUploadCoverForAudio,
  submitUploadCoverTask,
  uploadFileUrl,
} = require("../providers/suno-persona");
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
} = require("./voice-provider-profile-service");
const { sanitizeProviderError } = require("../utils/provider-sanitize");
const { parseJson } = require("../utils/common");
const { generatePrefixedId } = require("../utils/ids");
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
  const normalized = consentScope.trim().toLowerCase();
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

async function markPersonaGenerationStarted(db, jobId) {
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE voice_provider_jobs
        SET step = ?, updated_at = ?
      WHERE id = ? AND status = ?`,
    )
    .run("generate_persona", updatedAt, jobId, "running");
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
  if (providerProfile.provider !== "suno") {
    throw new Error("E302_SUNO_PERSONA_INVALID_PROVIDER");
  }
  if (providerProfile.deleted_at || providerProfile.status === "deleted") {
    throw new Error("E302_SUNO_PERSONA_PROFILE_DELETED");
  }
  if (providerProfile.status === "failed") {
    throw new Error("E302_SUNO_PERSONA_PROFILE_FAILED");
  }
  if (
    providerProfile.user_id !== job.user_id ||
    providerProfile.voice_profile_id !== job.voice_profile_id
  ) {
    throw new Error("E302_SUNO_PERSONA_PROFILE_JOB_MISMATCH");
  }
  const voiceProfile = await db
    .prepare(
      "SELECT id, status FROM voice_profiles WHERE id = ? AND user_id = ?",
    )
    .get(providerProfile.voice_profile_id, providerProfile.user_id);
  if (!voiceProfile || voiceProfile.status !== "active") {
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
  const currentJob = await getVoiceProviderJobById(db, jobId);
  const currentProfile = await getProviderProfileById(db, providerProfileId);
  const currentSession = sessionId
    ? await getEnrollmentSession(db, sessionId)
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
        sourceUploadUrl: null,
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
      const callBackUrl =
        config.SUNO_CALLBACK_URL && config.SUNO_CALLBACK_URL.trim();
      if (!callBackUrl) {
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
        timeoutMs: config.PROVIDER_TIMEOUT_MS,
        pollingOptions,
      });
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
      });
    }

    ({ providerProfile, session } = await assertProviderJobStillAllowed({
      db,
      jobId: job.id,
      providerProfileId: providerProfile.id,
      sessionId: session?.id,
    }));
    await markPersonaGenerationStarted(db, job.id);
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
    if (typeof stepData.vocal_start === "number") {
      personaArgs.vocalStart = stepData.vocal_start;
    }
    if (typeof stepData.vocal_end === "number") {
      personaArgs.vocalEnd = stepData.vocal_end;
    }
    const persona = await sunoClient.generatePersona(personaArgs);
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
      const manualRecoveryError = new Error(
        `E302_SUNO_PERSONA_MANUAL_RECOVERY_REQUIRED: ${sanitizeProviderError(err)}`,
      );
      const failedJob = await markVoiceProviderJobFailed(
        db,
        jobId,
        manualRecoveryError,
        {
          step: "generate_persona",
          retryable: false,
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
  hasPersonaConsentScope,
  enrollmentSessionHasPersonaConsent,
  runSunoVoicePersonaJob,
};
