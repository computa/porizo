process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminJobOpsRepository,
} = require("../src/database/admin-job-ops-repository");
const { createEventsRepository } = require("../src/database/events-repository");
const {
  createAdminAuditService,
} = require("../src/services/admin/audit-service");
const {
  createAdminJobOpsService,
} = require("../src/services/admin/job-ops-service");

let db;
let repository;

async function seedTrackVersion({
  userId = "user_job_ops",
  trackId = "track_job_ops",
  versionId = "version_job_ops",
} = {}) {
  const now = "2026-06-27T09:00:00.000Z";
  await db
    .prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)")
    .run(userId, now);
  await db
    .prepare(
      `INSERT OR IGNORE INTO tracks
        (id, user_id, status, title, latest_version, created_at, updated_at)
       VALUES (?, ?, 'ready', 'Job Ops Song', 1, ?, ?)`,
    )
    .run(trackId, userId, now, now);
  await db
    .prepare(
      `INSERT OR IGNORE INTO track_versions
        (id, track_id, version_num, status, render_type, params_hash, created_at)
       VALUES (?, ?, 1, 'completed', 'preview', ?, ?)`,
    )
    .run(versionId, trackId, `${versionId}_hash`, now);
  return { userId, trackId, versionId };
}

async function insertJob({
  id,
  trackVersionId = "version_job_ops",
  workflowType = "song_render",
  status = "queued",
  step = "ready",
  attempts = 0,
  errorCode = null,
  errorMessage = null,
  nextAttemptAt = null,
  lockedBy = null,
  lockedAt = null,
  createdAt = "2026-06-27T10:00:00.000Z",
  updatedAt = createdAt,
  stepData = null,
} = {}) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id,
        track_version_id,
        workflow_type,
        status,
        step,
        attempts,
        error_code,
        error_message,
        next_attempt_at,
        locked_by,
        locked_at,
        step_data,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackVersionId,
      workflowType,
      status,
      step,
      attempts,
      errorCode,
      errorMessage,
      nextAttemptAt,
      lockedBy,
      lockedAt,
      stepData,
      createdAt,
      updatedAt,
    );
}

describe("AdminJobOpsRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminJobOpsRepository(db);
    await seedTrackVersion();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listJobs filters jobs and joins track ids ordered by created_at descending", async () => {
    await insertJob({
      id: "job_old",
      status: "failed",
      workflowType: "song_render",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await insertJob({
      id: "job_new",
      status: "failed",
      workflowType: "song_render",
      createdAt: "2026-06-27T10:05:00.000Z",
    });
    await insertJob({
      id: "job_other",
      status: "queued",
      workflowType: "artwork",
      createdAt: "2026-06-27T10:10:00.000Z",
    });

    const jobs = await repository.listJobs({
      status: "failed",
      workflowType: "song_render",
      limit: 10,
      offset: 0,
    });

    assert.deepEqual(
      jobs.map((job) => ({ id: job.id, track_id: job.track_id })),
      [
        { id: "job_new", track_id: "track_job_ops" },
        { id: "job_old", track_id: "track_job_ops" },
      ],
    );
  });

  test("getJobMetrics returns status, workflow, stale, failure, and DLQ counts", async () => {
    await insertJob({
      id: "job_running_stale",
      status: "running",
      workflowType: "song_render",
      updatedAt: "2026-06-27T08:00:00.000Z",
    });
    await insertJob({
      id: "job_failed_recent",
      status: "failed",
      workflowType: "song_render",
      errorCode: "PROVIDER_TIMEOUT",
      createdAt: "2026-06-27T09:30:00.000Z",
    });
    await insertJob({
      id: "job_queued",
      status: "queued",
      workflowType: "artwork",
      createdAt: "2026-06-27T09:45:00.000Z",
    });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue
          (id, job_id, original_status, failure_reason, failure_count, moved_at)
         VALUES ('dlq_open', 'job_failed_recent', 'failed', 'timeout', 3, ?)`,
      )
      .run("2026-06-27T10:00:00.000Z");

    const metrics = await repository.getJobMetrics({
      staleBefore: "2026-06-27T08:30:00.000Z",
      failuresAfter: "2026-06-27T09:00:00.000Z",
    });

    assert.deepEqual(metrics.jobsByStatus, [
      { status: "failed", count: 1 },
      { status: "queued", count: 1 },
      { status: "running", count: 1 },
    ]);
    assert.deepEqual(metrics.jobsByWorkflow, [
      { workflow_type: "artwork", status: "queued", count: 1 },
      { workflow_type: "song_render", status: "failed", count: 1 },
      { workflow_type: "song_render", status: "running", count: 1 },
    ]);
    assert.equal(metrics.staleJobs, 1);
    assert.deepEqual(metrics.recentFailures, [
      { error_code: "PROVIDER_TIMEOUT", count: 1 },
    ]);
    assert.equal(metrics.dlqCount, 1);
  });

  test("listDLQ maps joined job rows into the admin response shape", async () => {
    await insertJob({
      id: "job_dlq",
      status: "failed",
      workflowType: "song_render",
      step: "mix",
      errorCode: null,
      errorMessage: null,
      stepData: JSON.stringify({ provider: "suno" }),
    });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue
          (id, job_id, original_status, failure_reason, failure_count, moved_at)
         VALUES ('dlq_job', 'job_dlq', 'failed', 'provider failed', 3, ?)`,
      )
      .run("2026-06-27T10:00:00.000Z");

    const rows = await repository.listDLQ({ limit: 10, offset: 0 });

    assert.deepEqual(rows, [
      {
        id: "dlq_job",
        job_id: "job_dlq",
        workflow_type: "song_render",
        step: "mix",
        error_code: null,
        error_message: "provider failed",
        payload_json: JSON.stringify({ provider: "suno" }),
        created_at: "2026-06-27T10:00:00.000Z",
        reprocessed_at: null,
      },
    ]);
  });

  test("retryFailedJob refuses to mutate jobs that are not failed", async () => {
    await insertJob({
      id: "job_not_failed",
      status: "running",
      attempts: 2,
      errorCode: "E_PROGRESS",
      errorMessage: "still running",
      updatedAt: "2026-06-27T10:00:00.000Z",
    });

    const result = await repository.retryFailedJob({
      jobId: "job_not_failed",
      now: "2026-06-27T10:05:00.000Z",
    });

    assert.equal(result.changes, 0);
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, attempts, error_code, error_message, updated_at FROM jobs WHERE id = ?",
        )
        .get("job_not_failed"),
      {
        status: "running",
        attempts: 2,
        error_code: "E_PROGRESS",
        error_message: "still running",
        updated_at: "2026-06-27T10:00:00.000Z",
      },
    );
  });

  test("reprocessDLQEntry requeues the job and marks the DLQ row atomically", async () => {
    await insertJob({
      id: "job_reprocess",
      status: "failed",
      attempts: 3,
      errorCode: "E500",
      errorMessage: "failed",
      nextAttemptAt: "2026-06-28T10:00:00.000Z",
      lockedBy: "worker_a",
      lockedAt: "2026-06-27T09:55:00.000Z",
    });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue
          (id, job_id, original_status, failure_reason, failure_count, moved_at)
         VALUES ('dlq_reprocess', 'job_reprocess', 'failed', 'failed', 3, ?)`,
      )
      .run("2026-06-27T10:00:00.000Z");

    await repository.reprocessDLQEntry({
      dlqId: "dlq_reprocess",
      jobId: "job_reprocess",
      now: "2026-06-27T10:05:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, attempts, error_code, error_message, next_attempt_at, locked_by, locked_at, updated_at FROM jobs WHERE id = ?",
        )
        .get("job_reprocess"),
      {
        status: "queued",
        attempts: 0,
        error_code: null,
        error_message: null,
        next_attempt_at: null,
        locked_by: null,
        locked_at: null,
        updated_at: "2026-06-27T10:05:00.000Z",
      },
    );
    assert.deepEqual(
      await db
        .prepare(
          "SELECT reprocessed_at, reprocess_job_id FROM dead_letter_queue WHERE id = ?",
        )
        .get("dlq_reprocess"),
      {
        reprocessed_at: "2026-06-27T10:05:00.000Z",
        reprocess_job_id: "job_reprocess",
      },
    );
  });

  test("listJobStepHistory returns rows ordered by started_at", async () => {
    await insertJob({ id: "job_steps" });
    await db
      .prepare(
        `INSERT INTO job_step_history
          (id, job_id, step_name, attempt, status, started_at)
         VALUES
          ('step_late', 'job_steps', 'mix', 1, 'completed', ?),
          ('step_early', 'job_steps', 'lyrics', 1, 'completed', ?)`,
      )
      .run("2026-06-27T10:05:00.000Z", "2026-06-27T10:00:00.000Z");

    const rows = await repository.listJobStepHistory("job_steps");

    assert.deepEqual(
      rows.map((row) => row.id),
      ["step_early", "step_late"],
    );
  });
});

describe("AdminJobOpsService repository integration", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminJobOpsRepository(db);
    await seedTrackVersion();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("retryJob delegates persistence and keeps audit contract", async () => {
    await insertJob({
      id: "job_retry",
      status: "failed",
      attempts: 2,
      errorCode: "E500",
      errorMessage: "provider failed",
    });
    const service = createAdminJobOpsService({
      adminJobOpsRepository: repository,
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    const result = await service.retryJob("job_retry", "admin_ops");

    assert.deepEqual(result, { success: true });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, attempts, error_code, error_message FROM jobs WHERE id = ?",
        )
        .get("job_retry"),
      {
        status: "queued",
        attempts: 0,
        error_code: null,
        error_message: null,
      },
    );

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_ops");

    assert.equal(auditRow.action, "admin_retry_job");
    assert.equal(auditRow.resource_type, "job");
    assert.equal(auditRow.resource_id, "job_retry");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_ops",
    });
  });

  test("retryJob does not audit success when the repository update loses a race", async () => {
    const service = createAdminJobOpsService({
      adminJobOpsRepository: {
        findJobById: async () => ({ id: "job_race", status: "failed" }),
        retryFailedJob: async () => ({ changes: 0 }),
      },
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    const result = await service.retryJob("job_race", "admin_ops");

    assert.deepEqual(result, {
      success: false,
      error: "Job is not failed",
    });
    assert.equal(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ? AND action = ?",
        )
        .get("admin_ops", "admin_retry_job").count,
      0,
    );
  });

  test("reprocessDLQ delegates persistence and keeps audit contract", async () => {
    await insertJob({
      id: "job_dlq_service",
      status: "failed",
      attempts: 3,
      errorCode: "E500",
      errorMessage: "provider failed",
    });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue
          (id, job_id, original_status, failure_reason, failure_count, moved_at)
         VALUES ('dlq_service', 'job_dlq_service', 'failed', 'failed', 3, ?)`,
      )
      .run("2026-06-27T10:00:00.000Z");
    const service = createAdminJobOpsService({
      adminJobOpsRepository: repository,
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    const result = await service.reprocessDLQ(
      "dlq_service",
      "admin_ops",
      "manual retry",
    );

    assert.deepEqual(result, {
      success: true,
      jobId: "job_dlq_service",
      dlqId: "dlq_service",
    });
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM jobs WHERE id = ?")
          .get("job_dlq_service")
      ).status,
      "queued",
    );

    const auditRow = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get("admin_ops");

    assert.equal(auditRow.action, "admin_reprocess_dlq");
    assert.equal(auditRow.resource_type, "job");
    assert.equal(auditRow.resource_id, "job_dlq_service");
    assert.deepEqual(JSON.parse(auditRow.metadata_json), {
      actor: "admin",
      admin_id: "admin_ops",
      dlqId: "dlq_service",
      reason: "manual retry",
    });
  });

  test("reprocessDLQ returns a failure result when the repository loses a race", async () => {
    const service = createAdminJobOpsService({
      adminJobOpsRepository: {
        findDLQById: async () => ({
          id: "dlq_race",
          job_id: "job_race",
          reprocessed_at: null,
        }),
        findJobById: async () => ({ id: "job_race", status: "failed" }),
        reprocessDLQEntry: async () => {
          throw new Error("DLQ entry not found or already reprocessed");
        },
      },
      audit: createAdminAuditService({
        eventsRepository: createEventsRepository(db),
      }).audit,
    });

    const result = await service.reprocessDLQ(
      "dlq_race",
      "admin_ops",
      "manual retry",
    );

    assert.deepEqual(result, {
      success: false,
      error: "DLQ entry already reprocessed",
    });
    assert.equal(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ? AND action = ?",
        )
        .get("admin_ops", "admin_reprocess_dlq").count,
      0,
    );
  });
});
