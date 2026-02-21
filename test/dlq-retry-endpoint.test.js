/**
 * DLQ Retry Endpoint Tests
 *
 * Tests POST /tracks/:id/versions/:version/retry
 * which allows users to re-queue failed or DLQ'd render jobs.
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, describe, after, before } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

let storageDir;
let db;
let app;
let config;
let storage;
const userId = "test-retry-user";

before(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-retry-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    UPLOAD_SIGNING_SECRET: "test-upload-secret",
    UPLOAD_URL_TTL_SEC: 900,
  };
  db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
  storage = createStorageProvider(config);
  app = buildServer({ db, config, storage });

  // Seed test user + entitlements
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO users (id, created_at) VALUES (?, ?)"
  ).run(userId, now);
  await db.prepare(
    "INSERT INTO entitlements (user_id, tier, credits_balance, updated_at) VALUES (?, 'free', 100, ?)"
  ).run(userId, now);
});

after(async () => {
  await app.close();
  db.close();
});

let testCounter = 0;
async function createTrackAndVersion() {
  testCounter++;
  const now = new Date().toISOString();
  const trackId = `track-retry-${testCounter}`;
  const versionId = `tv-retry-${testCounter}`;

  await db.prepare(
    "INSERT INTO tracks (id, user_id, title, recipient_name, message, occasion, style, voice_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(trackId, userId, "Test Song", "Bob", "Happy birthday", "birthday", "pop", "AI_Full", "failed", now, now);

  await db.prepare(
    "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(versionId, trackId, 1, "failed", "preview", "test-hash", now);

  // Create the version directory
  const versionDir = path.join(storageDir, "tracks", userId, trackId, "v1");
  fs.mkdirSync(versionDir, { recursive: true });

  return { trackId, versionId, versionDir };
}

async function createFailedJob(trackVersionId, workflowType = "preview_render", status = "failed") {
  const now = new Date().toISOString();
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await db.prepare(
    "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, error_code, error_message, progress_pct, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(jobId, trackVersionId, workflowType, status, "voice_convert", 3, 3, 5, "R205", "Voice conversion failed", 55, now, now, now);

  // Link job to track version
  const jobIdCol = workflowType === "full_render" ? "full_job_id" : "preview_job_id";
  await db.prepare(`UPDATE track_versions SET ${jobIdCol} = ? WHERE id = ?`).run(jobId, trackVersionId);

  return jobId;
}

describe("POST /tracks/:id/versions/:version/retry", () => {
  test("returns 202 on failed preview job", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 202);
    const body = res.json();
    assert.equal(body.job_id, jobId);
    assert.ok(body.poll_url.includes(jobId));

    // Verify job was re-queued
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");
    assert.equal(job.attempts, 0);
    assert.equal(job.error_code, null);
    assert.equal(job.error_message, null);
  });

  test("returns 202 on DLQ'd job and marks DLQ reprocessed", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId, "preview_render", "dead_letter");

    // Add DLQ entry
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO dead_letter_queue (id, job_id, original_status, failure_reason, failure_count, moved_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(`dlq-${Date.now()}`, jobId, "failed", "Max retries exceeded", 3, now);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 202);
    assert.equal(res.json().job_id, jobId);

    // Verify DLQ entry was marked reprocessed
    const dlqEntry = await db.prepare("SELECT * FROM dead_letter_queue WHERE job_id = ?").get(jobId);
    assert.ok(dlqEntry.reprocessed_at, "DLQ entry should be marked reprocessed");
    assert.equal(dlqEntry.reprocess_job_id, jobId);
  });

  test("returns 404 when no failed job exists", async () => {
    const { trackId } = await createTrackAndVersion();
    // No job created — nothing to retry

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "NO_FAILED_JOB");
  });

  test("is idempotent — returns active job if already retried", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId);

    // First retry
    const res1 = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });
    assert.equal(res1.statusCode, 202);

    // Second retry — job is now 'queued' (active), should return it
    const res2 = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });
    assert.equal(res2.statusCode, 202);
    assert.equal(res2.json().job_id, jobId);
  });

  test("resets track_version.status to processing", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    await createFailedJob(versionId);

    await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    const tv = await db.prepare("SELECT * FROM track_versions WHERE id = ?").get(versionId);
    assert.equal(tv.status, "processing");

    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackId);
    assert.equal(track.status, "rendering");
  });

  test("retry with render_type=full retries full render job", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId, "full_render");

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
      payload: { render_type: "full" },
    });

    assert.equal(res.statusCode, 202);
    assert.equal(res.json().job_id, jobId);

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");
    assert.equal(job.workflow_type, "full_render");
  });

  test("creates audit entry for retry", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId);

    await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    const audit = await db.prepare(
      "SELECT * FROM audit_logs WHERE action = 'user_retry_render' AND resource_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(jobId);
    assert.ok(audit, "Audit entry should exist");
    assert.equal(audit.user_id, userId);
  });
});
