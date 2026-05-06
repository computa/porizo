const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, describe, test } = require("node:test");

const { initDb } = require("../src/db");
const {
  STATUS,
  cancelVoiceProviderJobsForVoiceProfile,
  createPendingProviderProfile,
  createVoiceProviderJob,
  findActiveProviderProfileForUser,
  getVoiceProviderJobById,
  markProviderProfileActive,
  markProviderProfileFailed,
  markProviderProfilePersonaSubmitted,
  markProviderProfileUploadSubmitted,
  markVoiceProviderJobFailed,
  markVoiceProviderJobRunning,
  recoverStaleVoiceProviderJobs,
  softDeleteProviderProfilesForVoiceProfile,
} = require("../src/services/voice-provider-profile-service");

describe("voice provider profile service", () => {
  let db;

  beforeEach(async () => {
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO users (id, created_at) VALUES (?, ?)"
    ).run("user_1", now);
    await db.prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("voice_1", "user_1", "active", 0.92, "test", "voice_v1", now, now);
  });

  test("tracks Suno provider profile lifecycle without storing raw persona ids in jobs", async () => {
    const pending = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      consentScope: "suno_voice_persona_v1",
      metadata: { source: "enrollment" },
    });
    assert.equal(pending.status, STATUS.PENDING);
    assert.equal(pending.provider_profile_id, null);

    const uploaded = await markProviderProfileUploadSubmitted(db, pending.id, {
      sourceUploadUrl: "https://files.example.com/ref.wav",
    });
    assert.equal(uploaded.status, STATUS.UPLOAD_SUBMITTED);

    const submitted = await markProviderProfilePersonaSubmitted(db, pending.id, {
      sourceTaskId: "task_123",
      sourceAudioId: "audio_456",
      model: "V5_5",
    });
    assert.equal(submitted.status, STATUS.PERSONA_SUBMITTED);
    assert.equal(submitted.provider_profile_id, null);

    const active = await markProviderProfileActive(db, pending.id, {
      providerProfileId: "persona_live_789",
      model: "V5_5",
    });
    assert.equal(active.status, STATUS.ACTIVE);
    assert.equal(active.provider_profile_id, "persona_live_789");

    const found = await findActiveProviderProfileForUser(db, {
      userId: "user_1",
      provider: "suno",
    });
    assert.equal(found.id, active.id);
    assert.equal(found.provider_profile_id, "persona_live_789");

    const job = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: active.id,
      stepData: { provider_profile_local_id: active.id },
    });
    assert.equal(job.voice_provider_profile_id, active.id);
    assert.ok(!String(job.step_data).includes("persona_live_789"));
  });

  test("soft deletion disables active provider profiles before voice profile deletion", async () => {
    const pending = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
    });
    await markProviderProfileUploadSubmitted(db, pending.id, {
      sourceUploadUrl: "https://files.example.com/ref.wav",
    });
    await markProviderProfilePersonaSubmitted(db, pending.id, {
      sourceTaskId: "task_123",
      sourceAudioId: "audio_456",
      model: "V5_5",
    });
    await markProviderProfileActive(db, pending.id, {
      providerProfileId: "persona_live_789",
    });

    const deletedCount = await softDeleteProviderProfilesForVoiceProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      reason: "account_deletion",
    });
    assert.equal(deletedCount, 1);

    const found = await findActiveProviderProfileForUser(db, {
      userId: "user_1",
      provider: "suno",
    });
    assert.equal(found, undefined);
  });

  test("records provider preparation failures for retry/reporting", async () => {
    const pending = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
    });
    const failed = await markProviderProfileFailed(db, pending.id, new Error("persona rejected"));
    assert.equal(failed.status, STATUS.FAILED);
    assert.match(failed.last_error, /persona rejected/);
  });

  test("backs off retryable provider jobs instead of immediate retry", async () => {
    const pending = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
    });
    const job = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: pending.id,
    });
    await markVoiceProviderJobRunning(db, job.id, { lockedBy: "test" });
    const failed = await markVoiceProviderJobFailed(db, job.id, new Error("temporary provider error"), {
      retryable: true,
    });
    assert.equal(failed.status, "pending");
    assert.ok(failed.next_attempt_at);
    assert.ok(Date.parse(failed.next_attempt_at) > Date.now());
  });

  test("recovers stale running provider jobs and cancels deleted voice jobs", async () => {
    const pending = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
    });
    const job = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: pending.id,
    });
    await markVoiceProviderJobRunning(db, job.id, { lockedBy: "test" });
    await db.prepare("UPDATE voice_provider_jobs SET locked_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", job.id);

    const recovered = await recoverStaleVoiceProviderJobs(db, {
      staleBefore: "2000-01-01T00:01:00.000Z",
      provider: "suno",
    });
    assert.equal(recovered, 1);
    const recoveredJob = await getVoiceProviderJobById(db, job.id);
    assert.equal(recoveredJob.status, "pending");

    const cancelled = await cancelVoiceProviderJobsForVoiceProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      reason: "voice_profile_deleted",
    });
    assert.equal(cancelled, 1);
    const cancelledJob = await getVoiceProviderJobById(db, job.id);
    assert.equal(cancelledJob.status, STATUS.CANCELLED);
    assert.ok(cancelledJob.cancelled_at);
  });

  test("stale final-attempt provider jobs fail instead of getting stuck", async () => {
    const pending = await createPendingProviderProfile(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
    });
    const job = await createVoiceProviderJob(db, {
      voiceProfileId: "voice_1",
      userId: "user_1",
      provider: "suno",
      voiceProviderProfileId: pending.id,
      maxAttempts: 1,
    });
    await markVoiceProviderJobRunning(db, job.id, { lockedBy: "test" });
    await db.prepare("UPDATE voice_provider_jobs SET locked_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", job.id);

    const recovered = await recoverStaleVoiceProviderJobs(db, {
      staleBefore: "2000-01-01T00:01:00.000Z",
      provider: "suno",
    });
    assert.equal(recovered, 1);
    const recoveredJob = await getVoiceProviderJobById(db, job.id);
    assert.equal(recoveredJob.status, STATUS.FAILED);
    assert.equal(recoveredJob.next_attempt_at, null);
  });
});
