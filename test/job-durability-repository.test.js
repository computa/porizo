process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createJobDurabilityRepository,
} = require("../src/database/job-durability-repository");
const {
  createJobDurabilityService,
} = require("../src/workflows/durability");

let db;
let repository;

async function insertJob({
  id,
  trackVersionId = `${id}_version`,
  workflowType = "preview_render",
  status = "queued",
  step = null,
  stepIndex = 0,
  stepData = null,
  attempts = 0,
  maxAttempts = 3,
  lastHeartbeatAt = null,
  lockedBy = null,
  lockedAt = null,
  errorCode = null,
  errorMessage = null,
  progressPct = 0,
  nextAttemptAt = null,
  createdAt = "2026-06-27T00:00:00.000Z",
  updatedAt = "2026-06-27T00:00:00.000Z",
  completedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO jobs (
         id, track_version_id, workflow_type, status, step, step_index,
         step_data, attempts, max_attempts, last_heartbeat_at, locked_by,
         locked_at, error_code, error_message, progress_pct, next_attempt_at,
         created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackVersionId,
      workflowType,
      status,
      step,
      stepIndex,
      stepData,
      attempts,
      maxAttempts,
      lastHeartbeatAt,
      lockedBy,
      lockedAt,
      errorCode,
      errorMessage,
      progressPct,
      nextAttemptAt,
      createdAt,
      updatedAt,
      completedAt,
    );
}

describe("JobDurabilityRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createJobDurabilityRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("getDlqDecisionJob returns the status and attempt counters", async () => {
    await insertJob({
      id: "job_dlq_ready",
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
    });

    const row = await repository.getDlqDecisionJob("job_dlq_ready");

    assert.deepEqual(row, {
      status: "failed",
      attempts: 3,
      max_attempts: 3,
    });
  });

  test("finds jobs and version-scoped active or latest failed jobs", async () => {
    await insertJob({
      id: "job_active_old",
      trackVersionId: "tv_lookup_1",
      status: "queued",
      createdAt: "2026-06-27T00:01:00.000Z",
      updatedAt: "2026-06-27T00:01:00.000Z",
    });
    await insertJob({
      id: "job_active_new",
      trackVersionId: "tv_lookup_1",
      status: "running",
      createdAt: "2026-06-27T00:02:00.000Z",
      updatedAt: "2026-06-27T00:02:00.000Z",
    });
    await insertJob({
      id: "job_failed_old",
      trackVersionId: "tv_lookup_1",
      status: "failed",
      errorCode: "E_OLD",
      errorMessage: "old failure",
      updatedAt: "2026-06-27T00:03:00.000Z",
      completedAt: "2026-06-27T00:03:00.000Z",
    });
    await insertJob({
      id: "job_failed_new",
      trackVersionId: "tv_lookup_1",
      status: "blocked",
      errorCode: "E_NEW",
      errorMessage: "new failure",
      step: "lyrics",
      updatedAt: "2026-06-27T00:04:00.000Z",
      completedAt: "2026-06-27T00:04:00.000Z",
    });
    await insertJob({
      id: "job_failed_other_version",
      trackVersionId: "tv_lookup_2",
      status: "dead_letter",
      errorCode: "E_OTHER",
      errorMessage: "other failure",
      updatedAt: "2026-06-27T00:05:00.000Z",
      completedAt: "2026-06-27T00:05:00.000Z",
    });

    assert.equal(await repository.findById(null), null);
    const found = await repository.findById("job_active_new");
    assert.equal(found.id, "job_active_new");

    const active = await repository.findActiveForVersion({
      trackVersionId: "tv_lookup_1",
      workflowType: "preview_render",
    });
    assert.equal(active.id, "job_active_new");

    const latestFailed = await repository.findLatestFailedForVersion({
      trackVersionId: "tv_lookup_1",
      workflowType: "preview_render",
    });
    assert.equal(latestFailed.id, "job_failed_new");
    assert.equal(latestFailed.error_code, "E_NEW");

    const latestByVersion =
      await repository.listLatestFailuresForTrackVersions([
        "tv_lookup_1",
        "tv_lookup_2",
        "tv_lookup_1",
      ]);
    const byVersion = Object.fromEntries(
      latestByVersion.map((job) => [job.track_version_id, job.id]),
    );
    assert.deepEqual(byVersion, {
      tv_lookup_1: "job_failed_new",
      tv_lookup_2: "job_failed_other_version",
    });
  });

  test("updateCheckpoint stores merged checkpoint JSON and heartbeat", async () => {
    await insertJob({
      id: "job_checkpoint",
      status: "running",
      stepData: JSON.stringify({ moderation: { passed: true } }),
    });

    const existing = await repository.getCheckpointJob("job_checkpoint");
    const merged = {
      ...JSON.parse(existing.step_data),
      lyrics: { generated: true },
    };
    await repository.updateCheckpoint({
      jobId: "job_checkpoint",
      stepDataJson: JSON.stringify(merged),
      now: "2026-06-27T00:05:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT step_data, last_heartbeat_at, updated_at FROM jobs WHERE id = ?",
      )
      .get("job_checkpoint");

    assert.deepEqual(JSON.parse(row.step_data), {
      moderation: { passed: true },
      lyrics: { generated: true },
    });
    assert.equal(row.last_heartbeat_at, "2026-06-27T00:05:00.000Z");
    assert.equal(row.updated_at, "2026-06-27T00:05:00.000Z");
  });

  test("job lifecycle methods preserve runner state transitions and lock guards", async () => {
    await insertJob({
      id: "job_lifecycle_due",
      status: "queued",
      workflowType: "preview_render",
      createdAt: "2026-06-27T00:01:00.000Z",
      updatedAt: "2026-06-27T00:01:00.000Z",
    });
    await insertJob({
      id: "job_lifecycle_future",
      status: "queued",
      workflowType: "preview_render",
      nextAttemptAt: "2026-06-27T00:10:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    await insertJob({
      id: "job_lifecycle_artwork",
      status: "queued",
      workflowType: "artwork_render",
    });

    const runnable = await repository.listQueuedRunnableJobs({
      now: "2026-06-27T00:05:00.000Z",
      limit: 5,
    });
    assert.deepEqual(
      runnable.map((job) => job.id),
      ["job_lifecycle_due"],
    );

    assert.equal(
      (
        await repository.claimQueuedJob({
          jobId: "job_lifecycle_due",
          runnerId: "runner_a",
          now: "2026-06-27T00:05:00.000Z",
          progressPct: 10,
        })
      ).changes,
      1,
    );
    assert.equal(
      (
        await repository.markJobStepRunning({
          jobId: "job_lifecycle_due",
          runnerId: "runner_b",
          step: "lyrics",
          stepIndex: 1,
          progressPct: 20,
          now: "2026-06-27T00:06:00.000Z",
        })
      ).changes,
      0,
    );
    await repository.markJobStepRunning({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      step: "lyrics",
      stepIndex: 1,
      progressPct: 20,
      now: "2026-06-27T00:06:00.000Z",
    });
    await repository.attachExternalTask({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      externalTaskId: "task_123",
      stepDataJson: '{"task_id":"task_123"}',
      heartbeatAt: "2026-06-27T00:06:10.000Z",
      updatedAt: "2026-06-27T00:06:10.000Z",
    });
    await repository.heartbeatOwnedJob({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      heartbeatAt: "2026-06-27T00:06:20.000Z",
      updatedAt: "2026-06-27T00:06:20.000Z",
    });
    await repository.parkJobUntil({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      status: "queued",
      step: "lyrics",
      stepIndex: 1,
      stepDataJson: '{"parked":true}',
      progressPct: 20,
      heartbeatAt: "2026-06-27T00:06:30.000Z",
      nextAttemptAt: "2026-06-27T00:07:00.000Z",
      updatedAt: "2026-06-27T00:06:30.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT status, step, step_index, step_data, external_task_id,
                  progress_pct, next_attempt_at, locked_by, locked_at
           FROM jobs WHERE id = ?`,
        )
        .get("job_lifecycle_due"),
      {
        status: "queued",
        step: "lyrics",
        step_index: 1,
        step_data: '{"parked":true}',
        external_task_id: "task_123",
        progress_pct: 20,
        next_attempt_at: "2026-06-27T00:07:00.000Z",
        locked_by: null,
        locked_at: null,
      },
    );

    await db
      .prepare("UPDATE jobs SET locked_by = ?, status = ? WHERE id = ?")
      .run("runner_a", "running", "job_lifecycle_due");
    await repository.advanceJobForReroll({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      status: "queued",
      step: "instrumental",
      stepIndex: 2,
      stepDataJson: '{"reroll":true}',
      progressPct: 30,
      now: "2026-06-27T00:08:00.000Z",
    });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, step, step_index, step_data, external_task_id FROM jobs WHERE id = ?",
        )
        .get("job_lifecycle_due"),
      {
        status: "queued",
        step: "instrumental",
        step_index: 2,
        step_data: '{"reroll":true}',
        external_task_id: null,
      },
    );

    await db
      .prepare("UPDATE jobs SET locked_by = ?, status = ? WHERE id = ?")
      .run("runner_a", "running", "job_lifecycle_due");
    await repository.requeueJobAttempt({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      status: "queued",
      progressPct: 35,
      heartbeatAt: "2026-06-27T00:08:30.000Z",
      nextAttemptAt: null,
      updatedAt: "2026-06-27T00:08:30.000Z",
    });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT attempts, status, progress_pct, locked_by FROM jobs WHERE id = ?",
        )
        .get("job_lifecycle_due"),
      {
        attempts: 1,
        status: "queued",
        progress_pct: 35,
        locked_by: null,
      },
    );

    await db
      .prepare("UPDATE jobs SET locked_by = ?, status = ? WHERE id = ?")
      .run("runner_a", "running", "job_lifecycle_due");
    await repository.markJobFailed({
      jobId: "job_lifecycle_due",
      runnerId: "runner_a",
      status: "failed",
      step: "lyrics",
      stepIndex: 1,
      errorCode: "E_TEST",
      errorMessage: "failed",
      progressPct: 100,
      completedAt: "2026-06-27T00:09:00.000Z",
      updatedAt: "2026-06-27T00:09:00.000Z",
    });
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = ?").get("job_lifecycle_due")
        .status,
      "failed",
    );

    await repository.forceMarkJobFailed({
      jobId: "job_lifecycle_future",
      status: "failed",
      step: "lyrics",
      stepIndex: 1,
      errorCode: "E_FORCE",
      errorMessage: "forced",
      progressPct: 100,
      completedAt: "2026-06-27T00:09:30.000Z",
      updatedAt: "2026-06-27T00:09:30.000Z",
    });
    assert.equal(
      db
        .prepare("SELECT error_code FROM jobs WHERE id = ?")
        .get("job_lifecycle_future").error_code,
      "E_FORCE",
    );

    await insertJob({
      id: "job_lifecycle_advance",
      status: "running",
      lockedBy: "runner_a",
      lockedAt: "2026-06-27T00:09:00.000Z",
    });
    await repository.advanceJobToStep({
      jobId: "job_lifecycle_advance",
      runnerId: "runner_a",
      status: "queued",
      step: "music",
      stepIndex: 2,
      stepDataJson: '{"ok":true}',
      progressPct: 40,
      now: "2026-06-27T00:10:00.000Z",
    });
    await db
      .prepare("UPDATE jobs SET locked_by = ?, status = ? WHERE id = ?")
      .run("runner_a", "running", "job_lifecycle_advance");
    await repository.markJobTerminal({
      jobId: "job_lifecycle_advance",
      runnerId: "runner_a",
      status: "completed",
      progressPct: 100,
      completedAt: "2026-06-27T00:11:00.000Z",
      updatedAt: "2026-06-27T00:11:00.000Z",
    });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, progress_pct, completed_at, locked_by FROM jobs WHERE id = ?",
        )
        .get("job_lifecycle_advance"),
      {
        status: "completed",
        progress_pct: 100,
        completed_at: "2026-06-27T00:11:00.000Z",
        locked_by: null,
      },
    );
  });

  test("createStepHistory and finishStepHistory persist step observability", async () => {
    await insertJob({
      id: "job_step_history",
      status: "running",
    });

    await repository.createStepHistory({
      id: "step_history_1",
      jobId: "job_step_history",
      stepName: "lyrics",
      attempt: 2,
      status: "running",
      startedAt: "2026-06-27T00:05:00.000Z",
    });
    await repository.finishStepHistory({
      id: "step_history_1",
      status: "completed",
      completedAt: "2026-06-27T00:05:03.000Z",
      durationMs: 3000,
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT job_id, step_name, attempt, status, error_message, started_at, completed_at, duration_ms
           FROM job_step_history WHERE id = ?`,
        )
        .get("step_history_1"),
      {
        job_id: "job_step_history",
        step_name: "lyrics",
        attempt: 2,
        status: "completed",
        error_message: null,
        started_at: "2026-06-27T00:05:00.000Z",
        completed_at: "2026-06-27T00:05:03.000Z",
        duration_ms: 3000,
      },
    );
  });

  test("markOrphanedStepHistoryFailed fails running entries for terminal jobs", async () => {
    await insertJob({
      id: "job_step_orphaned",
      status: "failed",
    });
    await insertJob({
      id: "job_step_active",
      status: "running",
    });
    await repository.createStepHistory({
      id: "step_history_orphaned",
      jobId: "job_step_orphaned",
      stepName: "music",
      attempt: 1,
      status: "running",
      startedAt: "2026-06-27T00:05:00.000Z",
    });
    await repository.createStepHistory({
      id: "step_history_active",
      jobId: "job_step_active",
      stepName: "music",
      attempt: 1,
      status: "running",
      startedAt: "2026-06-27T00:05:00.000Z",
    });

    const changed = await repository.markOrphanedStepHistoryFailed({
      completedAt: "2026-06-27T00:06:00.000Z",
    });

    assert.equal(changed, 1);
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, error_message, completed_at, duration_ms FROM job_step_history WHERE id = ?",
        )
        .get("step_history_orphaned"),
      {
        status: "failed",
        error_message: "Worker crashed",
        completed_at: "2026-06-27T00:06:00.000Z",
        duration_ms: 0,
      },
    );
    assert.equal(
      db
        .prepare("SELECT status FROM job_step_history WHERE id = ?")
        .get("step_history_active").status,
      "running",
    );
  });

  test("recoverStaleJobs requeues only stale running jobs", async () => {
    await insertJob({
      id: "job_stale",
      status: "running",
      attempts: 1,
      lastHeartbeatAt: "2026-06-27T00:00:00.000Z",
      lockedBy: "old-worker",
      lockedAt: "2026-06-27T00:00:00.000Z",
    });
    await insertJob({
      id: "job_recent",
      status: "running",
      attempts: 1,
      lastHeartbeatAt: "2026-06-27T00:04:30.000Z",
      lockedBy: "current-worker",
      lockedAt: "2026-06-27T00:04:30.000Z",
    });

    const recovered = await repository.recoverStaleJobs({
      now: "2026-06-27T00:05:00.000Z",
      thresholdTime: "2026-06-27T00:01:00.000Z",
    });

    assert.equal(recovered, 1);
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, attempts, locked_by, locked_at, updated_at FROM jobs WHERE id = ?",
        )
        .get("job_stale"),
      {
        status: "queued",
        attempts: 2,
        locked_by: null,
        locked_at: null,
        updated_at: "2026-06-27T00:05:00.000Z",
      },
    );
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = ?").get("job_recent")
        .status,
      "running",
    );
  });

  test("recoverStaleJobs uses locked_at or updated_at when heartbeat is missing", async () => {
    await insertJob({
      id: "job_stale_locked",
      status: "running",
      attempts: 1,
      lastHeartbeatAt: null,
      lockedBy: "old-worker",
      lockedAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    await insertJob({
      id: "job_recent_locked",
      status: "running",
      attempts: 1,
      lastHeartbeatAt: null,
      lockedBy: "current-worker",
      lockedAt: "2026-06-27T00:04:30.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    await insertJob({
      id: "job_stale_updated_only",
      status: "running",
      attempts: 1,
      lastHeartbeatAt: null,
      lockedBy: null,
      lockedAt: null,
      updatedAt: "2026-06-27T00:00:00.000Z",
    });

    const recovered = await repository.recoverStaleJobs({
      now: "2026-06-27T00:05:00.000Z",
      thresholdTime: "2026-06-27T00:01:00.000Z",
    });

    assert.equal(recovered, 2);
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = ?").get("job_stale_locked")
        .status,
      "queued",
    );
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = ?").get("job_recent_locked")
        .status,
      "running",
    );
    assert.equal(
      db
        .prepare("SELECT status FROM jobs WHERE id = ?")
        .get("job_stale_updated_only").status,
      "queued",
    );
  });

  test("resetJobForAutoReprocess requeues only failed or dead-letter jobs", async () => {
    await insertJob({
      id: "job_auto_reprocess",
      status: "dead_letter",
      step: "voice_convert",
      stepIndex: 5,
      attempts: 3,
      errorCode: "E_PROVIDER",
      errorMessage: "provider timeout",
      completedAt: "2026-06-27T00:04:00.000Z",
      lockedBy: "old-worker",
      lockedAt: "2026-06-27T00:03:00.000Z",
    });
    await insertJob({
      id: "job_auto_running",
      status: "running",
      step: "voice_convert",
      attempts: 1,
    });

    const reset = await repository.resetJobForAutoReprocess({
      jobId: "job_auto_reprocess",
      now: "2026-06-27T00:05:00.000Z",
    });
    const skipped = await repository.resetJobForAutoReprocess({
      jobId: "job_auto_running",
      now: "2026-06-27T00:05:00.000Z",
    });

    assert.equal(reset.changes, 1);
    assert.equal(skipped.changes, 0);
    assert.deepEqual(
      await db
        .prepare(
          `SELECT status, step, step_index, attempts, error_code, error_message,
                  progress_pct, completed_at, next_attempt_at, locked_by, locked_at, updated_at
           FROM jobs WHERE id = ?`,
        )
        .get("job_auto_reprocess"),
      {
        status: "queued",
        step: "queued",
        step_index: 0,
        attempts: 0,
        error_code: null,
        error_message: null,
        progress_pct: 0,
        completed_at: null,
        next_attempt_at: null,
        locked_by: null,
        locked_at: null,
        updated_at: "2026-06-27T00:05:00.000Z",
      },
    );
  });

  test("appendDlqInsertFailure appends operator-visible DLQ failure context", async () => {
    await insertJob({
      id: "job_dlq_insert_failed",
      status: "failed",
      errorMessage: "original failure",
    });

    await repository.appendDlqInsertFailure({
      jobId: "job_dlq_insert_failed",
      errorMessage: "insert timeout",
      now: "2026-06-27T00:05:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare("SELECT error_message, updated_at FROM jobs WHERE id = ?")
        .get("job_dlq_insert_failed"),
      {
        error_message:
          "original failure [DLQ_INSERT_FAILED: insert timeout]",
        updated_at: "2026-06-27T00:05:00.000Z",
      },
    );
  });

  test("lists heartbeat-active users at capacity and maps candidate track versions to users", async () => {
    const now = "2026-06-27T00:05:00.000Z";
    for (const userId of ["user_capacity", "user_available"]) {
      await db
        .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
        .run(userId, now);
    }
    for (const { trackId, userId } of [
      { trackId: "track_capacity_1", userId: "user_capacity" },
      { trackId: "track_capacity_2", userId: "user_capacity" },
      { trackId: "track_available_1", userId: "user_available" },
    ]) {
      await db
        .prepare(
          `INSERT INTO tracks (
             id, user_id, status, title, latest_version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(trackId, userId, "rendering", "Fairness", 1, now, now);
    }
    for (const { versionId, trackId } of [
      { versionId: "tv_capacity_1", trackId: "track_capacity_1" },
      { versionId: "tv_capacity_2", trackId: "track_capacity_2" },
      { versionId: "tv_available_1", trackId: "track_available_1" },
    ]) {
      await db
        .prepare(
          `INSERT INTO track_versions (
             id, track_id, version_num, status, render_type, params_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(versionId, trackId, 1, "processing", "preview", versionId, now);
    }
    await insertJob({
      id: "job_capacity_1",
      trackVersionId: "tv_capacity_1",
      status: "running",
      lastHeartbeatAt: "2026-06-27T00:04:30.000Z",
    });
    await insertJob({
      id: "job_capacity_2",
      trackVersionId: "tv_capacity_2",
      status: "running",
      lastHeartbeatAt: "2026-06-27T00:04:30.000Z",
    });
    await insertJob({
      id: "job_available_1",
      trackVersionId: "tv_available_1",
      status: "running",
      lastHeartbeatAt: "2026-06-27T00:00:30.000Z",
    });

    const blockedUsers = await repository.listRunningUserIdsAtCapacity({
      heartbeatCutoff: "2026-06-27T00:03:00.000Z",
      maxConcurrent: 2,
    });
    const candidateUsers = await repository.listUserIdsForTrackVersionIds([
      "tv_available_1",
      "tv_capacity_1",
      "tv_capacity_1",
    ]);

    assert.deepEqual(blockedUsers, [{ user_id: "user_capacity" }]);
    assert.deepEqual(
      Object.fromEntries(
        candidateUsers.map((row) => [row.track_version_id, row.user_id]),
      ),
      {
        tv_available_1: "user_available",
        tv_capacity_1: "user_capacity",
      },
    );
    assert.deepEqual(await repository.listUserIdsForTrackVersionIds([]), []);
  });

  test("getJobHealth preserves durability service field source columns", async () => {
    await insertJob({
      id: "job_health",
      status: "failed",
      step: "lyrics",
      stepIndex: 2,
      attempts: 1,
      maxAttempts: 3,
      lastHeartbeatAt: "2026-06-27T00:03:00.000Z",
      errorCode: "R205",
      errorMessage: "Provider timeout",
    });

    const row = await repository.getJobHealth("job_health");

    assert.equal(row.status, "failed");
    assert.equal(row.step, "lyrics");
    assert.equal(row.step_index, 2);
    assert.equal(row.attempts, 1);
    assert.equal(row.max_attempts, 3);
    assert.equal(row.last_heartbeat_at, "2026-06-27T00:03:00.000Z");
    assert.equal(row.error_code, "R205");
    assert.equal(row.error_message, "Provider timeout");
  });

  test("getJobStatusCounts normalizes count values to numbers", async () => {
    await insertJob({ id: "job_count_queued", status: "queued" });
    await insertJob({ id: "job_count_running", status: "running" });
    await insertJob({ id: "job_count_running_2", status: "running" });

    const rows = await repository.getJobStatusCounts();
    const counts = Object.fromEntries(
      rows.map((row) => [row.status, row.count]),
    );

    assert.equal(counts.queued, 1);
    assert.equal(counts.running, 2);
    assert.equal(typeof counts.running, "number");
  });
});

describe("JobDurabilityService repository delegation", () => {
  test("saveCheckpoint keeps JSON merge policy in the service layer", async () => {
    const calls = [];
    const service = createJobDurabilityService({
      db: null,
      circuitBreaker: {
        isOpen: () => false,
        recordSuccess: async () => {},
        recordFailure: async () => {},
        getAllStats: () => ({}),
      },
      dlq: { getStats: async () => ({ total: 0 }) },
      repository: {
        getCheckpointJob: async () => ({
          step_data: JSON.stringify({ moderation: { passed: true } }),
        }),
        updateCheckpoint: async (args) => calls.push(args),
      },
    });

    await service.saveCheckpoint({
      jobId: "job_service_checkpoint",
      step: "lyrics",
      data: { generated: true },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].jobId, "job_service_checkpoint");
    assert.deepEqual(JSON.parse(calls[0].stepDataJson), {
      moderation: { passed: true },
      lyrics: { generated: true },
    });
    assert.match(calls[0].now, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("getJobHealth maps repository rows to the public service shape", async () => {
    const service = createJobDurabilityService({
      db: null,
      circuitBreaker: {
        isOpen: () => false,
        recordSuccess: async () => {},
        recordFailure: async () => {},
        getAllStats: () => ({}),
      },
      dlq: { getStats: async () => ({ total: 0 }) },
      repository: {
        getJobHealth: async () => ({
          status: "failed",
          step: "lyrics",
          step_index: 2,
          attempts: 1,
          max_attempts: 3,
          last_heartbeat_at: "2026-06-27T00:03:00.000Z",
          error_code: "R205",
          error_message: "Provider timeout",
        }),
      },
    });

    assert.deepEqual(await service.getJobHealth("job_service_health"), {
      status: "failed",
      currentStep: "lyrics",
      stepIndex: 2,
      attempts: 1,
      maxAttempts: 3,
      attemptsRemaining: 2,
      lastHeartbeat: "2026-06-27T00:03:00.000Z",
      errorCode: "R205",
      errorMessage: "Provider timeout",
    });
  });
});
