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
  createdAt = "2026-06-27T00:00:00.000Z",
  updatedAt = "2026-06-27T00:00:00.000Z",
  completedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO jobs (
         id, track_version_id, workflow_type, status, step, step_index,
         step_data, attempts, max_attempts, last_heartbeat_at, locked_by,
         locked_at, error_code, error_message, created_at, updated_at,
         completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
