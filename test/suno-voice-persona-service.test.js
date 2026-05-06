const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, describe, test } = require("node:test");

const { initDb } = require("../src/db");
const {
  REQUIRED_CONSENT_SCOPE,
  buildEnrollmentCleanAudioUrl,
  generatePersonaWithReadinessRetry,
  hasPersonaConsentScope,
  enrollmentSessionHasPersonaConsent,
  isRetryableGeneratePersonaReadinessError,
  runSunoVoicePersonaJob,
} = require("../src/services/suno-voice-persona-service");
const {
  cancelVoiceProviderJobsForVoiceProfile,
  createPendingProviderProfile,
  createVoiceProviderJob,
} = require("../src/services/voice-provider-profile-service");

describe("Suno voice persona service", () => {
  let db;

  beforeEach(async () => {
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
      .run("user_1", now);
    await db
      .prepare(
        `INSERT INTO enrollment_sessions (
        id, user_id, status, prompt_set_id, prompts_json, chunk_count,
        quality_metrics, started_at, expires_at, consent_version, access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "sess_1",
        "user_1",
        "completed",
        "default",
        "[]",
        0,
        "{}",
        now,
        now,
        REQUIRED_CONSENT_SCOPE,
        "token_123",
      );
    await db
      .prepare(
        `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "voice_1",
        "user_1",
        "active",
        90,
        "test",
        REQUIRED_CONSENT_SCOPE,
        now,
        now,
      );
  });

  test("hasPersonaConsentScope: recognizes Suno-specific consent in scope-string format", () => {
    assert.equal(hasPersonaConsentScope(REQUIRED_CONSENT_SCOPE), true);
    assert.equal(
      hasPersonaConsentScope(`app_v3+${REQUIRED_CONSENT_SCOPE}`),
      true,
    );
    assert.equal(
      hasPersonaConsentScope(`not_${REQUIRED_CONSENT_SCOPE}`),
      false,
    );
    assert.equal(hasPersonaConsentScope("voice_suno_persona_v10"), false);
    assert.equal(hasPersonaConsentScope("1.0"), false);
    assert.equal(hasPersonaConsentScope(null), false);
    assert.equal(hasPersonaConsentScope(""), false);
  });

  test("hasPersonaConsentScope: accepts JSON array and scopes-object formats", () => {
    assert.equal(
      hasPersonaConsentScope(JSON.stringify([REQUIRED_CONSENT_SCOPE, "other"])),
      true,
    );
    assert.equal(
      hasPersonaConsentScope(
        JSON.stringify({ scopes: [REQUIRED_CONSENT_SCOPE] }),
      ),
      true,
    );
    assert.equal(
      hasPersonaConsentScope(JSON.stringify(["other_scope"])),
      false,
    );
  });

  test("U2: enrollmentSessionHasPersonaConsent reads consent_scopes (NOT consent_version)", () => {
    // The original silent-deny bug: passing session.consent_version="1.0" as a scope.
    assert.equal(
      enrollmentSessionHasPersonaConsent({ consent_version: "1.0" }),
      false,
      "consent_version='1.0' alone must never grant persona consent",
    );
    assert.equal(
      enrollmentSessionHasPersonaConsent({
        consent_version: "1.0",
        consent_scopes: REQUIRED_CONSENT_SCOPE,
      }),
      true,
      "consent_scopes is the canonical signal",
    );
    assert.equal(
      enrollmentSessionHasPersonaConsent({ consent_scopes: null }),
      false,
      "null consent_scopes is fail-secure",
    );
    assert.equal(enrollmentSessionHasPersonaConsent(null), false);
    assert.equal(enrollmentSessionHasPersonaConsent(undefined), false);
  });

  test("retries transient generate-persona music readiness errors", async () => {
    assert.equal(
      isRetryableGeneratePersonaReadinessError(
        new Error(
          "E302_SUNO_PERSONA_ERROR: generate-persona failed - Music does not exist",
        ),
      ),
      true,
    );
    assert.equal(
      isRetryableGeneratePersonaReadinessError(
        new Error(
          "E302_SUNO_PERSONA_ERROR: generate-persona failed - create persona error",
        ),
      ),
      true,
    );

    let attempts = 0;
    const persona = await generatePersonaWithReadinessRetry({
      personaArgs: { taskId: "task_123", audioId: "audio_456" },
      maxAttempts: 3,
      delayMs: 0,
      sleepFn: async () => {},
      generatePersonaFn: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(
            "E302_SUNO_PERSONA_ERROR: generate-persona failed - Music does not exist",
          );
        }
        return { personaId: "persona_live_789" };
      },
    });

    assert.equal(attempts, 2);
    assert.equal(persona.personaId, "persona_live_789");
  });

  test("builds clean audio URL without storing the token in job data", () => {
    assert.equal(
      buildEnrollmentCleanAudioUrl({
        baseUrl: "https://porizo.example/",
        sessionId: "sess_1",
        accessToken: "token_123",
      }),
      "https://porizo.example/enrollment/sess_1/clean.wav?token=token_123",
    );
  });

  test("runs a queued provider job to active using a mocked Suno client", async () => {
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      stepData: {
        enrollment_session_id: "sess_1",
        source_audio_key: "enrollment/clean/user_1/sess_1/clean.wav",
        model: "V5_5",
        audio_weight: 0.85,
      },
    });
    let sourceUrlUsed = null;

    const active = await runSunoVoicePersonaJob({
      db,
      jobId: providerJob.id,
      config: {
        PUBLIC_BASE_URL: "https://porizo.example",
        STREAM_BASE_URL: "https://stream.example",
        SUNO_BASE_URL: "https://api.sunoapi.org",
        SUNO_FILE_UPLOAD_BASE_URL: "https://files.example",
        SUNO_API_KEY: "secret",
        SUNO_MODEL: "V5_5",
        SUNO_CALLBACK_URL: "https://porizo.test/internal/suno/callback",
        PROVIDER_TIMEOUT_MS: 30000,
      },
      sunoClient: {
        uploadFileUrl: async (options) => {
          sourceUrlUsed = options.fileUrl;
          return {
            downloadUrl: "https://temp.example/clean.wav",
            fileName: "clean.wav",
            mimeType: "audio/wav",
            fileSize: 1000,
          };
        },
        submitUploadCoverTask: async () => ({
          taskId: "task_123",
          model: "V5_5",
        }),
        pollUploadCoverForAudio: async () => ({
          audioId: "audio_456",
          response: { data: { taskId: "task_123" } },
        }),
        generatePersona: async () => ({
          personaId: "persona_live_789",
          name: "Porizo Voice",
        }),
      },
    });

    assert.equal(
      sourceUrlUsed,
      "https://porizo.example/enrollment/sess_1/clean.wav?token=token_123",
    );
    assert.equal(active.status, "active");
    assert.equal(active.provider_profile_id, "persona_live_789");
    assert.equal(active.source_task_id, "task_123");
    assert.equal(active.source_audio_id, "audio_456");

    const job = await db
      .prepare("SELECT * FROM voice_provider_jobs WHERE id = ?")
      .get(providerJob.id);
    assert.equal(job.status, "completed");
    assert.ok(!String(job.step_data).includes("persona_live_789"));
    const session = await db
      .prepare("SELECT access_token FROM enrollment_sessions WHERE id = ?")
      .get("sess_1");
    assert.equal(session.access_token, null);
  });

  test("fails without Suno-specific consent before calling the provider", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET consent_version = ? WHERE id = ?",
      )
      .run("1.0", "sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: "1.0",
    });
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      stepData: {
        enrollment_session_id: "sess_1",
      },
    });
    let called = false;

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: { PUBLIC_BASE_URL: "https://porizo.example" },
        sunoClient: {
          uploadFileUrl: async () => {
            called = true;
          },
        },
      }),
      /CONSENT_REQUIRED/,
    );
    assert.equal(called, false);

    const failedProfile = await db
      .prepare(
        "SELECT status, last_error FROM voice_provider_profiles WHERE id = ?",
      )
      .get(providerProfile.id);
    assert.equal(failedProfile.status, "failed");
    assert.match(failedProfile.last_error, /CONSENT_REQUIRED/);
  });

  test("resumes from stored task and audio ids without repeating earlier provider calls", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?",
      )
      .run("sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    await db
      .prepare(
        "UPDATE voice_provider_profiles SET status = ?, source_task_id = ?, source_audio_id = ? WHERE id = ?",
      )
      .run("persona_submitted", "task_123", "audio_456", providerProfile.id);
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      stepData: { enrollment_session_id: "sess_1" },
    });
    const calls = [];

    const active = await runSunoVoicePersonaJob({
      db,
      jobId: providerJob.id,
      config: {
        PUBLIC_BASE_URL: "https://porizo.example",
        SUNO_BASE_URL: "https://api.sunoapi.org",
        SUNO_API_KEY: "secret",
        SUNO_CALLBACK_URL: "https://porizo.test/internal/suno/callback",
      },
      sunoClient: {
        uploadFileUrl: async () => calls.push("upload"),
        submitUploadCoverTask: async () => calls.push("cover"),
        pollUploadCoverForAudio: async () => calls.push("poll"),
        generatePersona: async () => {
          calls.push("persona");
          return { personaId: "persona_live_789", name: "Porizo Voice" };
        },
      },
    });

    assert.deepEqual(calls, ["persona"]);
    assert.equal(active.provider_profile_id, "persona_live_789");
  });

  test("resumes polling from stored task id after the source token is revoked", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?",
      )
      .run("sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    await db
      .prepare(
        "UPDATE voice_provider_profiles SET status = ?, source_task_id = ? WHERE id = ?",
      )
      // U9: cover-stage rows store "cover_submitted" (was "upload_submitted").
      .run("cover_submitted", "task_123", providerProfile.id);
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      stepData: { enrollment_session_id: "sess_1" },
    });
    const calls = [];

    const active = await runSunoVoicePersonaJob({
      db,
      jobId: providerJob.id,
      config: {
        PUBLIC_BASE_URL: "https://porizo.example",
        SUNO_BASE_URL: "https://api.sunoapi.org",
        SUNO_API_KEY: "secret",
        SUNO_CALLBACK_URL: "https://porizo.test/internal/suno/callback",
      },
      sunoClient: {
        uploadFileUrl: async () => calls.push("upload"),
        submitUploadCoverTask: async () => calls.push("cover"),
        pollUploadCoverForAudio: async () => {
          calls.push("poll");
          return {
            audioId: "audio_456",
            response: { data: { taskId: "task_123" } },
          };
        },
        generatePersona: async () => {
          calls.push("persona");
          return { personaId: "persona_live_789", name: "Porizo Voice" };
        },
      },
    });

    assert.deepEqual(calls, ["poll", "persona"]);
    assert.equal(active.provider_profile_id, "persona_live_789");
  });

  test("does not claim completed jobs for provider execution", async () => {
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      stepData: { enrollment_session_id: "sess_1" },
    });
    await db
      .prepare(
        "UPDATE voice_provider_jobs SET status = 'completed' WHERE id = ?",
      )
      .run(providerJob.id);

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: { PUBLIC_BASE_URL: "https://porizo.example" },
      }),
      /JOB_NOT_CLAIMED/,
    );
  });

  test("terminal provider failure revokes source token and rethrows sanitized error", async () => {
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      maxAttempts: 1,
      stepData: { enrollment_session_id: "sess_1" },
    });

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: {
          PUBLIC_BASE_URL: "https://porizo.example",
          SUNO_BASE_URL: "https://api.sunoapi.org",
          SUNO_API_KEY: "secret",
        },
        sunoClient: {
          uploadFileUrl: async () => {
            throw new Error(
              "provider failed https://porizo.example/clean.wav?token=token_123 persona_live_789",
            );
          },
          submitUploadCoverTask: async () => null,
          pollUploadCoverForAudio: async () => null,
          generatePersona: async () => null,
        },
      }),
      (err) => {
        assert.match(err.message, /\[redacted_url\]/);
        assert.doesNotMatch(err.message, /token_123/);
        assert.doesNotMatch(err.message, /persona_live_789/);
        return true;
      },
    );

    const session = await db
      .prepare("SELECT access_token FROM enrollment_sessions WHERE id = ?")
      .get("sess_1");
    assert.equal(session.access_token, null);
    const failedProfile = await db
      .prepare(
        "SELECT status, last_error FROM voice_provider_profiles WHERE id = ?",
      )
      .get(providerProfile.id);
    assert.equal(failedProfile.status, "failed");
    assert.doesNotMatch(failedProfile.last_error, /token_123/);
    assert.doesNotMatch(failedProfile.last_error, /persona_live_789/);
  });

  test("honors voice deletion before creating a remote persona", async () => {
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      maxAttempts: 1,
      stepData: {
        enrollment_session_id: "sess_1",
        source_audio_key: "enrollment/clean/user_1/sess_1/clean.wav",
      },
    });
    let personaCalled = false;

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: {
          PUBLIC_BASE_URL: "https://porizo.example",
          SUNO_BASE_URL: "https://api.sunoapi.org",
          SUNO_FILE_UPLOAD_BASE_URL: "https://files.example",
          SUNO_API_KEY: "secret",
          SUNO_CALLBACK_URL: "https://porizo.test/internal/suno/callback",
        },
        sunoClient: {
          uploadFileUrl: async () => ({
            downloadUrl: "https://temp.example/clean.wav",
            fileName: "clean.wav",
          }),
          submitUploadCoverTask: async () => ({
            taskId: "task_123",
            model: "V5_5",
          }),
          pollUploadCoverForAudio: async () => {
            await cancelVoiceProviderJobsForVoiceProfile(db, {
              voiceProfileId: "voice_1",
              userId: "user_1",
              reason: "voice_profile_deleted",
            });
            await db
              .prepare(
                "UPDATE voice_provider_profiles SET deleted_at = ?, status = ? WHERE id = ?",
              )
              .run(new Date().toISOString(), "deleted", providerProfile.id);
            return {
              audioId: "audio_456",
              response: { data: { taskId: "task_123" } },
            };
          },
          generatePersona: async () => {
            personaCalled = true;
            return { personaId: "persona_live_789" };
          },
        },
      }),
      /PROFILE_DELETED|JOB_CANCELLED/,
    );
    assert.equal(personaCalled, false);
  });

  test("does not automatically retry after generate persona request may have been sent", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?",
      )
      .run("sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    await db
      .prepare(
        "UPDATE voice_provider_profiles SET status = ?, source_task_id = ?, source_audio_id = ? WHERE id = ?",
      )
      .run("persona_submitted", "task_123", "audio_456", providerProfile.id);
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      maxAttempts: 3,
      stepData: { enrollment_session_id: "sess_1" },
    });

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: {
          PUBLIC_BASE_URL: "https://porizo.example",
          SUNO_BASE_URL: "https://api.sunoapi.org",
          SUNO_API_KEY: "secret",
        },
        sunoClient: {
          uploadFileUrl: async () => null,
          submitUploadCoverTask: async () => null,
          pollUploadCoverForAudio: async () => null,
          generatePersona: async () => {
            throw new Error("network timeout after provider request");
          },
        },
      }),
      /MANUAL_RECOVERY_REQUIRED/,
    );

    const job = await db
      .prepare(
        "SELECT status, step, next_attempt_at FROM voice_provider_jobs WHERE id = ?",
      )
      .get(providerJob.id);
    assert.equal(job.status, "failed");
    assert.equal(job.step, "generate_persona");
    assert.equal(job.next_attempt_at, null);
  });

  test("records rejected source audio when Suno says current music cannot generate persona", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?",
      )
      .run("sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    await db
      .prepare(
        "UPDATE voice_provider_profiles SET status = ?, source_task_id = ?, source_audio_id = ?, metadata_json = ? WHERE id = ?",
      )
      .run(
        "persona_submitted",
        "task_123",
        "audio_bad",
        JSON.stringify({ suno_source_audio_duration_sec: 30 }),
        providerProfile.id,
      );
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      maxAttempts: 1,
      stepData: { enrollment_session_id: "sess_1" },
    });

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: {
          PUBLIC_BASE_URL: "https://porizo.example",
          SUNO_BASE_URL: "https://api.sunoapi.org",
          SUNO_API_KEY: "secret",
          SUNO_PERSONA_GENERATE_MAX_ATTEMPTS: 1,
          SUNO_PERSONA_GENERATE_RETRY_DELAY_MS: 0,
        },
        sunoClient: {
          uploadFileUrl: async () => null,
          submitUploadCoverTask: async () => null,
          pollUploadCoverForAudio: async () => null,
          generatePersona: async () => {
            throw new Error(
              "E302_SUNO_PERSONA_ERROR: generate-persona failed - Current music failed to generate persona",
            );
          },
        },
      }),
      /MANUAL_RECOVERY_REQUIRED/,
    );

    const profile = await db
      .prepare(
        "SELECT status, metadata_json FROM voice_provider_profiles WHERE id = ?",
      )
      .get(providerProfile.id);
    assert.equal(profile.status, "failed");
    const metadata = JSON.parse(profile.metadata_json);
    assert.equal(metadata.suno_bad_source_music, true);
    assert.deepEqual(metadata.suno_rejected_source_audio_ids, ["audio_bad"]);
  });

  test("keeps provider job pending after Suno create-persona readiness errors", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?",
      )
      .run("sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    await db
      .prepare(
        "UPDATE voice_provider_profiles SET status = ?, source_task_id = ?, source_audio_id = ? WHERE id = ?",
      )
      .run("persona_submitted", "task_123", "audio_456", providerProfile.id);
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      maxAttempts: 3,
      stepData: { enrollment_session_id: "sess_1" },
    });

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: {
          PUBLIC_BASE_URL: "https://porizo.example",
          SUNO_BASE_URL: "https://api.sunoapi.org",
          SUNO_API_KEY: "secret",
          SUNO_PERSONA_GENERATE_MAX_ATTEMPTS: 1,
          SUNO_PERSONA_GENERATE_RETRY_DELAY_MS: 0,
        },
        sunoClient: {
          uploadFileUrl: async () => null,
          submitUploadCoverTask: async () => null,
          pollUploadCoverForAudio: async () => null,
          generatePersona: async () => {
            throw new Error(
              "E302_SUNO_PERSONA_ERROR: generate-persona failed - create persona error",
            );
          },
        },
      }),
      /create persona error/,
    );

    const job = await db
      .prepare(
        "SELECT status, step, attempts, next_attempt_at FROM voice_provider_jobs WHERE id = ?",
      )
      .get(providerJob.id);
    assert.equal(job.status, "pending");
    assert.equal(job.step, "generate_persona");
    assert.equal(job.attempts, 1);
    assert.ok(job.next_attempt_at);

    const profile = await db
      .prepare(
        "SELECT status, last_error FROM voice_provider_profiles WHERE id = ?",
      )
      .get(providerProfile.id);
    assert.equal(profile.status, "persona_submitted");
    assert.match(profile.last_error || "", /^$/);
  });

  test("preserves remote persona id for manual cleanup if deletion wins during generate", async () => {
    await db
      .prepare(
        "UPDATE enrollment_sessions SET access_token = NULL WHERE id = ?",
      )
      .run("sess_1");
    const providerProfile = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: REQUIRED_CONSENT_SCOPE,
    });
    await db
      .prepare(
        "UPDATE voice_provider_profiles SET status = ?, source_task_id = ?, source_audio_id = ? WHERE id = ?",
      )
      .run("persona_submitted", "task_123", "audio_456", providerProfile.id);
    const providerJob = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: providerProfile.id,
      maxAttempts: 1,
      stepData: { enrollment_session_id: "sess_1" },
    });

    await assert.rejects(
      runSunoVoicePersonaJob({
        db,
        jobId: providerJob.id,
        config: {
          PUBLIC_BASE_URL: "https://porizo.example",
          SUNO_BASE_URL: "https://api.sunoapi.org",
          SUNO_API_KEY: "secret",
        },
        sunoClient: {
          uploadFileUrl: async () => null,
          submitUploadCoverTask: async () => null,
          pollUploadCoverForAudio: async () => null,
          generatePersona: async () => {
            await cancelVoiceProviderJobsForVoiceProfile(db, {
              voiceProfileId: "voice_1",
              userId: "user_1",
              reason: "voice_profile_deleted",
            });
            await db
              .prepare(
                "UPDATE voice_provider_profiles SET deleted_at = ?, status = ? WHERE id = ?",
              )
              .run(new Date().toISOString(), "deleted", providerProfile.id);
            return {
              personaId: "persona_live_after_delete",
              name: "Porizo Voice",
            };
          },
        },
      }),
      /MANUAL_RECOVERY_REQUIRED/,
    );

    const profile = await db
      .prepare(
        "SELECT status, provider_profile_id, last_error FROM voice_provider_profiles WHERE id = ?",
      )
      .get(providerProfile.id);
    assert.equal(profile.status, "manual_cleanup_required");
    assert.equal(profile.provider_profile_id, "persona_live_after_delete");
    assert.match(
      profile.last_error,
      /MANUAL_CLEANUP_REQUIRED|MANUAL_RECOVERY_REQUIRED/,
    );
  });
});
