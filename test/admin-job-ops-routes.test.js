require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

const NOW = "2026-06-27T10:00:00.000Z";

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
    },
    storage: {
      put: async () => {},
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      getSignedUrl: async (key) => `http://localhost/${key}`,
    },
  });
}

async function loginAdmin(app, email = "admin@porizo.app") {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email, password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedTrackVersion(db) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run("job_ops_route_user", NOW);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'job_ops_route_user', 'ready', 'Job Ops Route', 1, ?, ?)`,
    )
    .run("job_ops_route_track", NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, 'job_ops_route_track', 1, 'completed', 'preview', ?, ?)`,
    )
    .run("job_ops_route_version", "job_ops_route_hash", NOW);
}

async function insertJob(
  db,
  {
    id,
    trackVersionId = "job_ops_route_version",
    workflowType = "song_render",
    status = "queued",
    step = "ready",
    attempts = 0,
    errorCode = null,
    errorMessage = null,
    stepData = null,
    createdAt = NOW,
    updatedAt = createdAt,
  },
) {
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
        step_data,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      stepData,
      createdAt,
      updatedAt,
    );
}

async function insertDlq(db, { id, jobId, reason = "failed", movedAt = NOW }) {
  await db
    .prepare(
      `INSERT INTO dead_letter_queue (
        id, job_id, original_status, failure_reason, failure_count, moved_at
      ) VALUES (?, ?, 'failed', ?, 3, ?)`,
    )
    .run(id, jobId, reason, movedAt);
}

describe("admin job ops routes", () => {
  let db;
  let app;
  let superadminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    superadminHeaders = await loginAdmin(app);
    await seedTrackVersion(db);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("GET /admin/dashboard/jobs requires admin session and preserves filters", async () => {
    await insertJob(db, {
      id: "job_ops_route_old",
      status: "failed",
      workflowType: "song_render",
      createdAt: "2026-06-27T09:00:00.000Z",
    });
    await insertJob(db, {
      id: "job_ops_route_new",
      status: "failed",
      workflowType: "song_render",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await insertJob(db, {
      id: "job_ops_route_other",
      status: "queued",
      workflowType: "artwork",
      createdAt: "2026-06-27T11:00:00.000Z",
    });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/admin/dashboard/jobs",
    });
    assert.equal(unauthorized.statusCode, 401, unauthorized.body);
    assert.equal(unauthorized.json().error, "UNAUTHORIZED");

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/jobs?status=failed&workflowType=song_render&limit=500&offset=-5",
      headers: superadminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      response.json().jobs.map((job) => ({
        id: job.id,
        track_id: job.track_id,
        status: job.status,
        workflow_type: job.workflow_type,
      })),
      [
        {
          id: "job_ops_route_new",
          track_id: "job_ops_route_track",
          status: "failed",
          workflow_type: "song_render",
        },
        {
          id: "job_ops_route_old",
          track_id: "job_ops_route_track",
          status: "failed",
          workflow_type: "song_render",
        },
      ],
    );
  });

  test("POST /admin/dashboard/jobs/:id/retry requeues failed jobs and preserves errors", async () => {
    await insertJob(db, {
      id: "job_ops_route_retry",
      status: "failed",
      attempts: 2,
      errorCode: "E500",
      errorMessage: "provider failed",
    });
    await insertJob(db, {
      id: "job_ops_route_running",
      status: "running",
    });

    const success = await app.inject({
      method: "POST",
      url: "/admin/dashboard/jobs/job_ops_route_retry/retry",
      headers: superadminHeaders,
    });

    assert.equal(success.statusCode, 200, success.body);
    assert.deepEqual(success.json(), { success: true });
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status, attempts, error_code, error_message FROM jobs WHERE id = ?",
        )
        .get("job_ops_route_retry"),
      {
        status: "queued",
        attempts: 0,
        error_code: null,
        error_message: null,
      },
    );

    const notFailed = await app.inject({
      method: "POST",
      url: "/admin/dashboard/jobs/job_ops_route_running/retry",
      headers: superadminHeaders,
    });
    assert.equal(notFailed.statusCode, 400, notFailed.body);
    assert.equal(notFailed.json().error, "RETRY_ERROR");
  });

  test("DLQ routes preserve list and superadmin reprocess behavior", async () => {
    await insertJob(db, {
      id: "job_ops_route_dlq",
      status: "failed",
      attempts: 3,
      errorCode: "E500",
      errorMessage: "provider failed",
      stepData: JSON.stringify({ provider: "suno" }),
    });
    await insertDlq(db, {
      id: "dlq_ops_route",
      jobId: "job_ops_route_dlq",
      reason: "provider failed",
    });

    const unauthorizedList = await app.inject({
      method: "GET",
      url: "/admin/dashboard/dlq",
    });
    assert.equal(unauthorizedList.statusCode, 401, unauthorizedList.body);
    assert.equal(unauthorizedList.json().error, "UNAUTHORIZED");

    const list = await app.inject({
      method: "GET",
      url: "/admin/dashboard/dlq?limit=500&offset=-5",
      headers: superadminHeaders,
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(list.json().entries, [
      {
        id: "dlq_ops_route",
        job_id: "job_ops_route_dlq",
        workflow_type: "song_render",
        step: "ready",
        error_code: "E500",
        error_message: "provider failed",
        payload_json: JSON.stringify({ provider: "suno" }),
        created_at: NOW,
        reprocessed_at: null,
      },
    ]);

    const createdAdmin = await adminAuthService.createAdmin(
      "job-ops-admin@example.com",
      "admin123",
      "Job Ops Admin",
      "admin",
    );
    assert.equal(createdAdmin.success, true);
    const adminHeaders = await loginAdmin(app, "job-ops-admin@example.com");
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/dashboard/dlq/dlq_ops_route/reprocess",
      headers: adminHeaders,
      payload: { reason: "operator retry" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error, "FORBIDDEN");

    const reprocess = await app.inject({
      method: "POST",
      url: "/admin/dashboard/dlq/dlq_ops_route/reprocess",
      headers: superadminHeaders,
      payload: { reason: "operator retry" },
    });
    assert.equal(reprocess.statusCode, 200, reprocess.body);
    assert.deepEqual(reprocess.json(), {
      success: true,
      jobId: "job_ops_route_dlq",
      dlqId: "dlq_ops_route",
    });
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM jobs WHERE id = ?")
          .get("job_ops_route_dlq")
      ).status,
      "queued",
    );
  });

  test("GET /admin/dashboard/jobs/:id/steps requires admin and preserves step order", async () => {
    await insertJob(db, { id: "job_ops_route_steps" });
    await db
      .prepare(
        `INSERT INTO job_step_history
          (id, job_id, step_name, attempt, status, started_at)
         VALUES
          ('step_ops_route_late', 'job_ops_route_steps', 'mix', 1, 'completed', ?),
          ('step_ops_route_early', 'job_ops_route_steps', 'lyrics', 1, 'completed', ?)`,
      )
      .run("2026-06-27T10:05:00.000Z", "2026-06-27T10:00:00.000Z");

    const unauthorized = await app.inject({
      method: "GET",
      url: "/admin/dashboard/jobs/job_ops_route_steps/steps",
    });
    assert.equal(unauthorized.statusCode, 401, unauthorized.body);
    assert.equal(unauthorized.json().error, "UNAUTHORIZED");

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/jobs/job_ops_route_steps/steps",
      headers: superadminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      response.json().steps.map((step) => ({
        id: step.id,
        job_id: step.job_id,
        step_name: step.step_name,
        status: step.status,
      })),
      [
        {
          id: "step_ops_route_early",
          job_id: "job_ops_route_steps",
          step_name: "lyrics",
          status: "completed",
        },
        {
          id: "step_ops_route_late",
          job_id: "job_ops_route_steps",
          step_name: "mix",
          status: "completed",
        },
      ],
    );
  });
});
