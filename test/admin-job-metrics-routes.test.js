require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

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

async function loginAdmin(app) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

async function seedTrackVersion(db) {
  const now = isoAgo(10 * DAYS);
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')",
    )
    .run("job_metrics_owner", now);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, latest_version, created_at, updated_at
      ) VALUES (?, 'job_metrics_owner', 'complete', 'Job Metrics Song', 1, ?, ?)`,
    )
    .run("job_metrics_track", now, now);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, 'job_metrics_track', 1, 'complete', 'preview', ?, ?)`,
    )
    .run("job_metrics_version", "job_metrics_hash", now);
}

async function seedJob(
  db,
  {
    id,
    workflowType,
    status,
    errorCode = null,
    createdAt,
    updatedAt = createdAt,
  },
) {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, track_version_id, workflow_type, status, error_code, created_at, updated_at
      ) VALUES (?, 'job_metrics_version', ?, ?, ?, ?, ?)`,
    )
    .run(id, workflowType, status, errorCode, createdAt, updatedAt);
}

function countMap(rows, key = "status") {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

describe("admin job metrics routes", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    adminHeaders = await loginAdmin(app);
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("job metrics require an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/jobs",
    });

    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  test("job metrics preserve status, workflow, stale, failure, and DLQ aggregates", async () => {
    await seedTrackVersion(db);
    await seedJob(db, {
      id: "job_metrics_running_stale",
      workflowType: "song_render",
      status: "running",
      createdAt: isoAgo(2 * HOURS),
      updatedAt: isoAgo(1 * HOURS),
    });
    await seedJob(db, {
      id: "job_metrics_failed_recent",
      workflowType: "song_render",
      status: "failed",
      errorCode: "PROVIDER_TIMEOUT",
      createdAt: isoAgo(1 * HOURS),
    });
    await seedJob(db, {
      id: "job_metrics_queued_artwork",
      workflowType: "artwork",
      status: "queued",
      createdAt: isoAgo(30 * 60 * 1000),
    });
    await seedJob(db, {
      id: "job_metrics_failed_old",
      workflowType: "song_render",
      status: "failed",
      errorCode: "OLD_PROVIDER_ERROR",
      createdAt: isoAgo(8 * DAYS),
    });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue
          (id, job_id, original_status, failure_reason, failure_count, moved_at)
         VALUES ('job_metrics_dlq_open', 'job_metrics_failed_recent', 'failed', 'timeout', 3, ?)`,
      )
      .run(isoAgo(45 * 60 * 1000));

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/metrics/jobs",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(countMap(body.jobsByStatus), {
      failed: 2,
      queued: 1,
      running: 1,
    });
    assert.deepEqual(
      Object.fromEntries(
        body.jobsByWorkflow.map((row) => [
          `${row.workflow_type}:${row.status}`,
          row.count,
        ]),
      ),
      {
        "artwork:queued": 1,
        "song_render:failed": 2,
        "song_render:running": 1,
      },
    );
    assert.equal(body.staleJobs, 1);
    assert.deepEqual(body.recentFailures, [
      { error_code: "PROVIDER_TIMEOUT", count: 1 },
    ]);
    assert.equal(body.dlqCount, 1);
  });
});
