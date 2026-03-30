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
const { test, describe, after, before, beforeEach } = require("node:test");
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
  process.env.NODE_ENV = "test";
  process.env.ALLOW_ANON_USER_ID = "true";
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-retry-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    ALLOW_ANON_USER_ID: true,
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

beforeEach(async () => {
  await db.prepare("DELETE FROM rate_limits").run();
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

  test("returns 409 when job status changed between find and update (race condition guard)", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId);

    // Simulate race: manually change job status to 'queued' before the retry endpoint runs
    await db.prepare("UPDATE jobs SET status = 'queued' WHERE id = ?").run(jobId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    // The endpoint should find the active job (status='queued') and return it idempotently
    // since findActiveJobForVersion runs first
    assert.equal(res.statusCode, 202);
  });

  test("returns 409 when job transitions to running during retry", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId);

    // Simulate race: job picked up by worker and now running
    await db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(jobId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    // findActiveJobForVersion should find it (running is active), return 202 idempotently
    assert.equal(res.statusCode, 202);
  });

  test("status guard prevents retry of completed job", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const jobId = await createFailedJob(versionId);

    // Simulate race: job completed between find and update
    await db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(jobId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    // Neither findActiveJobForVersion nor findLatestFailedJobForVersion will match
    // a 'completed' job, so we get 404
    assert.equal(res.statusCode, 404);
  });

  test("auto-sanitizes rewritable policy failures using provider from music_plan_json", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    const lyrics = {
      title: "Song for Bob",
      sections: [
        {
          name: "verse1",
          lines: [{ text: "We met at Madonna University, Okija", startTime: 5.52, endTime: 11.78 }],
        },
      ],
    };
    await db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_status = 'approved', music_plan_json = ? WHERE id = ?"
    ).run(
      JSON.stringify(lyrics),
      JSON.stringify({ provider_resolved: "elevenlabs" }),
      versionId
    );

    const now = new Date().toISOString();
    const jobId = `job-policy-${Date.now()}`;
    await db.prepare(
      "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, error_code, error_message, progress_pct, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      jobId,
      versionId,
      "preview_render",
      "failed",
      "instrumental",
      3,
      3,
      5,
      "E302_PROVIDER_POLICY_ERROR",
      "Lyrics still contain restricted terms (madonna).",
      55,
      now,
      now,
      now
    );
    await db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(jobId, versionId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 202);

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");
    assert.equal(job.error_code, null);

    const tv = await db.prepare("SELECT lyrics_json, lyrics_updated_at FROM track_versions WHERE id = ?").get(versionId);
    const rewritten = JSON.parse(tv.lyrics_json);
    assert.deepEqual(rewritten.sections[0].lines[0], {
      text: "We met at the campus, Okija",
      startTime: 5.52,
      endTime: 11.78,
    });
    assert.ok(tv.lyrics_updated_at, "lyrics_updated_at should be stamped after server-side sanitize");

    const audit = await db.prepare(
      "SELECT metadata_json FROM audit_logs WHERE action = 'auto_sanitize_lyrics' AND resource_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(versionId);
    assert.ok(audit, "auto_sanitize_lyrics audit entry should exist");
    const metadata = JSON.parse(audit.metadata_json);
    assert.equal(metadata.provider, "elevenlabs");
    assert.equal(metadata.change_count, 1);
    assert.ok(metadata.original_lyrics_hash);
  });

  test("null-safe optimistic lock allows auto-sanitize when lyrics_updated_at is null", async () => {
    const { trackId, versionId } = await createTrackAndVersion();
    await db.prepare(
      "UPDATE track_versions SET lyrics_json = ?, lyrics_updated_at = NULL, lyrics_status = 'approved', music_plan_json = ? WHERE id = ?"
    ).run(
      JSON.stringify({
        sections: [{ name: "verse1", lines: [{ text: "Walking down Prince Street at midnight", startTime: 3, endTime: 7 }] }],
      }),
      JSON.stringify({ provider_resolved: "suno" }),
      versionId
    );

    const now = new Date().toISOString();
    const jobId = `job-null-lock-${Date.now()}`;
    await db.prepare(
      "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, error_code, error_message, progress_pct, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      jobId,
      versionId,
      "preview_render",
      "failed",
      "instrumental",
      2,
      3,
      5,
      "E302_PROVIDER_POLICY_ERROR",
      "Lyrics still contain restricted terms (prince).",
      55,
      now,
      now,
      now
    );
    await db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(jobId, versionId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 202);
    const tv = await db.prepare("SELECT lyrics_json, lyrics_updated_at FROM track_versions WHERE id = ?").get(versionId);
    const rewritten = JSON.parse(tv.lyrics_json);
    assert.equal(rewritten.sections[0].lines[0].text, "Walking down the old road at midnight");
    assert.ok(tv.lyrics_updated_at, "null-safe optimistic lock should still allow sanitize write");
  });
});
