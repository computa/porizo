process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createVoiceProviderProfileRepository,
} = require("../src/database/voice-provider-profile-repository");

const NOW = "2026-06-26T01:02:03.000Z";
const LATER = "2026-06-26T01:05:03.000Z";

let db;
let repository;

async function seedVoiceProfile() {
  await db
    .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
    .run("repo_user", NOW);
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version,
        consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "repo_voice",
      "repo_user",
      "pending_provider",
      0.91,
      "test",
      "voice_v1",
      NOW,
      NOW,
    );
}

describe("VoiceProviderProfileRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createVoiceProviderProfileRepository(db);
    await seedVoiceProfile();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("inserts and updates provider profile rows without shape transforms", async () => {
    await repository.insertProviderProfile({
      id: "vpp_repo",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      status: "pending",
      consentScope: "suno_voice_persona_v1",
      metadataJson: '{"source":"repository-test"}',
      createdAt: NOW,
      updatedAt: NOW,
    });

    const inserted = await repository.getProviderProfileById("vpp_repo");
    assert.equal(inserted.voice_profile_id, "repo_voice");
    assert.equal(inserted.user_id, "repo_user");
    assert.equal(inserted.provider, "suno");
    assert.equal(inserted.status, "pending");
    assert.equal(inserted.consent_scope, "suno_voice_persona_v1");
    assert.equal(inserted.metadata_json, '{"source":"repository-test"}');

    const update = await repository.updateProviderProfileUploadSubmitted({
      id: "vpp_repo",
      status: "upload_submitted",
      sourceUploadUrl: "https://files.example.com/repo.wav",
      metadataJson: '{"stage":"upload"}',
      updatedAt: LATER,
      allowedStatuses: ["pending", "upload_submitted"],
    });
    assert.equal(update.changes, 1);

    const updated = await repository.getProviderProfileById("vpp_repo");
    assert.equal(updated.status, "upload_submitted");
    assert.equal(updated.source_upload_url, "https://files.example.com/repo.wav");
    assert.equal(updated.metadata_json, '{"stage":"upload"}');
    assert.equal(updated.updated_at, LATER);
  });

  test("hasActiveVoiceProfileForUser checks active voice profile status", async () => {
    assert.equal(await repository.hasActiveVoiceProfileForUser("repo_user"), false);

    await db
      .prepare("UPDATE voice_profiles SET status = 'active' WHERE id = ?")
      .run("repo_voice");

    assert.equal(await repository.hasActiveVoiceProfileForUser("repo_user"), true);
    assert.equal(await repository.hasActiveVoiceProfileForUser("missing_user"), false);
    assert.deepEqual(
      await repository.findVoiceProfileStatus({
        voiceProfileId: "repo_voice",
        userId: "repo_user",
      }),
      { id: "repo_voice", status: "active" },
    );
  });

  test("reads route-facing voice profile rows for profile, reverify, and delete flows", async () => {
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, quality_score, model_version, consent_version,
          consent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "repo_voice_active",
        "repo_user",
        "active",
        0.95,
        "test",
        "voice_v1",
        NOW,
        LATER,
      );
    await db
      .prepare(
        `INSERT INTO voice_profiles (
          id, user_id, status, quality_score, model_version, consent_version,
          consent_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "repo_voice_deleted",
        "repo_user",
        "deleted",
        0.5,
        "test",
        "voice_v1",
        NOW,
        "2026-06-26T01:10:03.000Z",
      );

    const active = await repository.findActiveVoiceProfileForUser("repo_user");
    assert.equal(active.id, "repo_voice_active");

    await db
      .prepare("UPDATE voice_profiles SET status = ? WHERE id = ?")
      .run("pending_provider", "repo_voice_active");

    const latest =
      await repository.findLatestNonDeletedVoiceProfileForUser("repo_user");
    assert.equal(latest.id, "repo_voice_active");

    await db
      .prepare("UPDATE voice_profiles SET status = ? WHERE id = ?")
      .run("active", "repo_voice_active");

    const activeId = await repository.findActiveVoiceProfileIdForUser("repo_user");
    assert.deepEqual(activeId, { id: "repo_voice_active" });

    const deletable = await repository.findDeletableVoiceProfileForUser(
      "repo_user",
    );
    assert.notEqual(deletable.status, "deleted");
  });

  test("terminal stale job recovery can fail the linked provider profile", async () => {
    await repository.insertProviderProfile({
      id: "vpp_repo_stale",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      status: "persona_submitted",
      consentScope: null,
      metadataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.insertVoiceProviderJob({
      id: "vpj_repo_stale",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      voiceProviderProfileId: "vpp_repo_stale",
      status: "running",
      step: "generate_persona",
      maxAttempts: 1,
      stepDataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db
      .prepare(
        "UPDATE voice_provider_jobs SET attempts = 1, locked_at = ? WHERE id = ?",
      )
      .run(NOW, "vpj_repo_stale");

    const failedJobs = await repository.markTerminalStaleVoiceProviderJobs({
      status: "failed",
      lastError: "terminal",
      updatedAt: LATER,
      runningStatus: "running",
      provider: "suno",
      staleBefore: LATER,
      terminalStep: "generate_persona",
    });
    assert.equal(failedJobs, 1);

    await repository.failProviderProfilesForTerminalJobs({
      status: "failed",
      lastError: "profile terminal",
      updatedAt: LATER,
      provider: "suno",
      failedJobStatus: "failed",
      inProgressStatuses: [
        "pending",
        "upload_submitted",
        "cover_submitted",
        "persona_submitted",
      ],
      activeJobStatuses: ["pending", "running"],
    });

    const profile = await repository.getProviderProfileById("vpp_repo_stale");
    assert.equal(profile.status, "failed");
    assert.equal(profile.last_error, "profile terminal");
  });

  test("lists due Suno jobs in deterministic order and heartbeats only owned running jobs", async () => {
    await repository.insertProviderProfile({
      id: "vpp_repo_queue",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      status: "pending",
      consentScope: null,
      metadataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const jobs = [
      { id: "vpj_due_old", provider: "suno", createdAt: NOW, updatedAt: NOW },
      {
        id: "vpj_due_new",
        provider: "suno",
        createdAt: LATER,
        updatedAt: LATER,
      },
      {
        id: "vpj_future",
        provider: "suno",
        createdAt: NOW,
        updatedAt: NOW,
        nextAttemptAt: "2026-06-26T01:10:03.000Z",
      },
      {
        id: "vpj_exhausted",
        provider: "suno",
        createdAt: NOW,
        updatedAt: NOW,
        attempts: 3,
      },
      {
        id: "vpj_replicate",
        provider: "replicate",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    for (const job of jobs) {
      await repository.insertVoiceProviderJob({
        id: job.id,
        voiceProfileId: "repo_voice",
        userId: "repo_user",
        provider: job.provider,
        voiceProviderProfileId:
          job.provider === "suno" ? "vpp_repo_queue" : null,
        status: "pending",
        step: "prepare_persona",
        maxAttempts: 3,
        stepDataJson: null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
      if (job.nextAttemptAt || job.attempts) {
        await db
          .prepare(
            "UPDATE voice_provider_jobs SET next_attempt_at = COALESCE(?, next_attempt_at), attempts = COALESCE(?, attempts) WHERE id = ?",
          )
          .run(job.nextAttemptAt || null, job.attempts || null, job.id);
      }
    }

    const due = await repository.listDueVoiceProviderJobs({
      provider: "suno",
      status: "pending",
      now: LATER,
      limit: 10,
    });
    assert.deepEqual(
      due.map((job) => job.id),
      ["vpj_due_old", "vpj_due_new"],
    );

    await db
      .prepare(
        "UPDATE voice_provider_jobs SET status = 'running', locked_by = ?, locked_at = ? WHERE id = ?",
      )
      .run("runner_a", NOW, "vpj_due_old");
    assert.equal(
      await repository.heartbeatVoiceProviderJob({
        id: "vpj_due_old",
        lockedBy: "runner_b",
        runningStatus: "running",
        lockedAt: LATER,
      }),
      0,
    );
    assert.equal(
      await repository.heartbeatVoiceProviderJob({
        id: "vpj_due_old",
        lockedBy: "runner_a",
        runningStatus: "running",
        lockedAt: LATER,
      }),
      1,
    );
    const refreshed = await repository.getVoiceProviderJobById("vpj_due_old");
    assert.equal(refreshed.locked_at, LATER);
  });

  test("hydrates execution context with job, provider profile, voice status, and enrollment session", async () => {
    await db
      .prepare(
        "INSERT INTO enrollment_sessions (id, user_id, status, started_at, expires_at, consent_version, consent_scopes, access_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "sess_repo",
        "repo_user",
        "completed",
        NOW,
        LATER,
        "1.0",
        "voice_suno_persona_v1",
        "token_repo",
      );
    await repository.insertProviderProfile({
      id: "vpp_repo_context",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      status: "cover_submitted",
      consentScope: "voice_suno_persona_v1",
      metadataJson: '{"stage":"cover"}',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.insertVoiceProviderJob({
      id: "vpj_repo_context",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      voiceProviderProfileId: "vpp_repo_context",
      status: "running",
      step: "generate_persona",
      maxAttempts: 3,
      stepDataJson: '{"enrollment_session_id":"sess_repo"}',
      createdAt: NOW,
      updatedAt: NOW,
    });

    const context = await repository.getVoiceProviderJobExecutionContext({
      jobId: "vpj_repo_context",
      providerProfileId: "vpp_repo_context",
      sessionId: "sess_repo",
    });

    assert.equal(context.job.id, "vpj_repo_context");
    assert.equal(context.providerProfile.id, "vpp_repo_context");
    assert.equal(context.providerProfile.voice_profile_status, "pending_provider");
    assert.equal(context.session.id, "sess_repo");
    assert.equal(context.session.consent_scopes, "voice_suno_persona_v1");
  });

  test("resets rejected source-audio retry states with the original status guards", async () => {
    await repository.insertProviderProfile({
      id: "vpp_repo_retry",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      status: "persona_submitted",
      consentScope: null,
      metadataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.updateProviderProfilePersonaSubmitted({
      id: "vpp_repo_retry",
      status: "persona_submitted",
      sourceTaskId: "task_retry",
      sourceAudioId: "audio_bad",
      model: "V5_5",
      metadataJson: '{"before":true}',
      updatedAt: NOW,
      allowedStatuses: ["persona_submitted"],
    });

    assert.equal(
      await repository.resetProviderProfileSourceAudioForRetry({
        id: "vpp_repo_retry",
        status: "cover_submitted",
        lastError: "bad source",
        metadataJson: '{"retry":"same_task_audio"}',
        updatedAt: LATER,
        allowedStatuses: ["persona_submitted", "failed"],
      }),
      1,
    );
    let profile = await repository.getProviderProfileById("vpp_repo_retry");
    assert.equal(profile.status, "cover_submitted");
    assert.equal(profile.source_task_id, "task_retry");
    assert.equal(profile.source_audio_id, null);
    assert.equal(profile.last_error, "bad source");

    assert.equal(
      await repository.resetProviderProfileFreshCoverForRetry({
        id: "vpp_repo_retry",
        status: "upload_submitted",
        lastError: "fresh cover",
        metadataJson: '{"retry":"fresh_cover_task"}',
        updatedAt: LATER,
        allowedStatuses: ["persona_submitted", "cover_submitted", "failed"],
      }),
      1,
    );
    profile = await repository.getProviderProfileById("vpp_repo_retry");
    assert.equal(profile.status, "upload_submitted");
    assert.equal(profile.source_task_id, null);
    assert.equal(profile.source_audio_id, null);
    assert.equal(profile.source_upload_url, null);
    assert.equal(profile.last_error, "fresh cover");
  });

  test("lists, scrubs, and deletes user voice-provider rows for account deletion", async () => {
    await repository.insertProviderProfile({
      id: "vpp_repo_delete",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      status: "pending",
      consentScope: null,
      metadataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.updateProviderProfileUploadSubmitted({
      id: "vpp_repo_delete",
      status: "upload_submitted",
      sourceUploadUrl: "https://files.example.com/source.wav",
      metadataJson: null,
      updatedAt: NOW,
      allowedStatuses: ["pending"],
    });
    await repository.insertVoiceProviderJob({
      id: "vpj_repo_delete",
      voiceProfileId: "repo_voice",
      userId: "repo_user",
      provider: "suno",
      voiceProviderProfileId: "vpp_repo_delete",
      status: "pending",
      step: "prepare_persona",
      maxAttempts: 3,
      stepDataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const profiles = await repository.listProviderProfilesForUser({
      userId: "repo_user",
    });
    assert.deepEqual(
      profiles.map((profile) => profile.id),
      ["vpp_repo_delete"],
    );

    assert.equal(
      await repository.softDeleteProviderProfilesForUser({
        userId: "repo_user",
        status: "deleted",
        lastError: "account_deletion",
        deletedAt: LATER,
        updatedAt: LATER,
      }),
      1,
    );
    const scrubbed = await repository.getProviderProfileById("vpp_repo_delete");
    assert.equal(scrubbed.status, "deleted");
    assert.equal(scrubbed.provider_profile_id, null);
    assert.equal(scrubbed.source_upload_url, null);
    assert.equal(scrubbed.source_task_id, null);
    assert.equal(scrubbed.source_audio_id, null);
    assert.equal(scrubbed.last_error, "account_deletion");
    assert.equal(scrubbed.deleted_at, LATER);

    assert.equal(
      await repository.deleteVoiceProviderJobsForUser({ userId: "repo_user" }),
      1,
    );
    assert.equal(await repository.getVoiceProviderJobById("vpj_repo_delete"), undefined);
  });
});
