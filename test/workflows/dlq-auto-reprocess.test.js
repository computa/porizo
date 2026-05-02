/**
 * DLQ Auto-Reprocessor Tests
 *
 * Tests the background timer that automatically re-queues dead-letter jobs
 * for transient/infra errors, while skipping policy errors.
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, describe, after, before } = require("node:test");
const { initDb } = require("../../src/db");
const { startJobRunner } = require("../../src/workflows/runner");

let storageDir;
let db;
let runner;
const userId = "test-dlq-user";

before(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-dlq-auto-"));
  db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });

  // Seed test user
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
  await db.prepare(
    "INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at) VALUES (?, 'free', 100, ?)"
  ).run(userId, now);

  runner = await startJobRunner({
    db,
    storageDir,
    streamBaseUrl: "http://stream.local",
    intervalMs: 1000000, // Don't run the main tick loop
    providerConfig: {},
    recoverStaleJobs: false,
  });
});

after(() => {
  runner.stop();
  db.close();
});

let testCounter = 0;
async function seedDLQEntry({ errorMessage, movedMinutesAgo = 10, autoReprocessCount = 0, step = "voice_convert" }) {
  testCounter++;
  const now = new Date().toISOString();
  const movedAt = new Date(Date.now() - movedMinutesAgo * 60 * 1000).toISOString();
  const trackId = `track-dlq-${testCounter}`;
  const versionId = `tv-dlq-${testCounter}`;
  const jobId = `job-dlq-${testCounter}`;
  const dlqId = `dlq-${testCounter}`;

  await db.prepare(
    "INSERT INTO tracks (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(trackId, userId, "Test Song", "failed", now, now);

  await db.prepare(
    "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(versionId, trackId, 1, "failed", "preview", "hash", now);

  await db.prepare(
    "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, error_message, progress_pct, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(jobId, versionId, "preview_render", "dead_letter", step, 3, 3, 5, errorMessage, 55, now, now, now);

  await db.prepare(
    "INSERT INTO dead_letter_queue (id, job_id, original_status, failure_reason, failure_count, moved_at, auto_reprocess_count) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(dlqId, jobId, "failed", errorMessage, 3, movedAt, autoReprocessCount);

  // Create version directory
  const versionDir = path.join(storageDir, "tracks", userId, trackId, "v1");
  fs.mkdirSync(versionDir, { recursive: true });

  return { trackId, versionId, jobId, dlqId, versionDir };
}

describe("DLQ Auto-Reprocessor", () => {
  test("auto-retries non-policy errors after 5min cooldown", async () => {
    const { jobId, dlqId } = await seedDLQEntry({
      errorMessage: "download_error:corrupted:File too small (0 bytes)",
      movedMinutesAgo: 10,
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued", "Job should be re-queued");
    assert.equal(job.attempts, 0, "Attempts should be reset");

    const dlq = await db.prepare("SELECT * FROM dead_letter_queue WHERE id = ?").get(dlqId);
    assert.ok(dlq.reprocessed_at, "DLQ should be marked reprocessed");
    assert.equal(dlq.auto_reprocess_count, 1);
  });

  test("does NOT auto-retry E302_PROVIDER_POLICY_ERROR", async () => {
    const { jobId, dlqId } = await seedDLQEntry({
      errorMessage: "E302_PROVIDER_POLICY_ERROR: Content violates provider policy",
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter", "Policy error job should remain in DLQ");

    const dlq = await db.prepare("SELECT * FROM dead_letter_queue WHERE id = ?").get(dlqId);
    assert.equal(dlq.reprocessed_at, null, "DLQ entry should not be reprocessed");
  });

  test("does NOT auto-retry E302_SUNO_POLICY_ERROR", async () => {
    const { jobId } = await seedDLQEntry({
      errorMessage: "E302_SUNO_POLICY_ERROR: Suno rejected the lyrics",
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter");
  });

  test("does NOT auto-retry E302_QUALITY_GATE_FAILED", async () => {
    const { jobId } = await seedDLQEntry({
      errorMessage: "E302_QUALITY_GATE_FAILED: Audio quality below threshold",
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter");
  });

  test("does NOT auto-retry E301_ELEVENLABS_VALIDATION", async () => {
    const { jobId } = await seedDLQEntry({
      errorMessage: "E301_ELEVENLABS_VALIDATION: Voice validation failed",
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter");
  });

  test("stops after 2 auto-reprocess attempts", async () => {
    const { jobId, dlqId } = await seedDLQEntry({
      errorMessage: "provider_error:500:Internal server error",
      autoReprocessCount: 2, // Already at max
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter", "Job at max attempts should stay in DLQ");

    const dlq = await db.prepare("SELECT * FROM dead_letter_queue WHERE id = ?").get(dlqId);
    assert.equal(dlq.reprocessed_at, null);
  });

  test("skips entries within 5min cooldown", async () => {
    const { jobId } = await seedDLQEntry({
      errorMessage: "provider_error:503:Service unavailable",
      movedMinutesAgo: 2, // Too recent
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter", "Recent DLQ entry should not be retried yet");
  });

  test("preserves valid cached source_for_conversion.mp3 before re-queuing", async () => {
    const { jobId, versionDir } = await seedDLQEntry({
      errorMessage: "provider_error:gpu_abort:GPU task aborted",
      step: "voice_convert",
    });

    // Valid cached input — downloaded from Suno in a prior attempt
    fs.writeFileSync(path.join(versionDir, "source_for_conversion.mp3"), "valid-audio-data");
    // Stale output — may be corrupt from failed voice conversion
    fs.mkdirSync(path.join(versionDir, "stems"), { recursive: true });
    fs.writeFileSync(path.join(versionDir, "stems", "vocals.wav"), "corrupt-partial");

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");
    assert.ok(fs.existsSync(path.join(versionDir, "source_for_conversion.mp3")),
      "Valid cached input should be preserved (provider URL may have expired)");
    assert.ok(!fs.existsSync(path.join(versionDir, "stems", "vocals.wav")),
      "Stale output files should still be cleaned");
  });

  test("cleans 0-byte source_for_conversion.mp3 before re-queuing", async () => {
    const { jobId, versionDir } = await seedDLQEntry({
      errorMessage: "download_error:timeout",
      step: "voice_convert",
    });

    // 0-byte file from a failed download — should be cleaned
    fs.writeFileSync(path.join(versionDir, "source_for_conversion.mp3"), "");

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");
    assert.ok(!fs.existsSync(path.join(versionDir, "source_for_conversion.mp3")),
      "0-byte source file should be cleaned");
  });

  test("does NOT auto-retry E301_SOURCE_URL_EXPIRED", async () => {
    const { jobId } = await seedDLQEntry({
      errorMessage: "E301_SOURCE_URL_EXPIRED: Provider audio URL returned empty response",
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "dead_letter", "Expired URL job should remain in DLQ");
  });

  test("resets track_version and track status", async () => {
    const { jobId, versionId, trackId } = await seedDLQEntry({
      errorMessage: "provider_error:500:Internal error",
      movedMinutesAgo: 60, // Oldest entry — ensures it's within LIMIT 5
    });

    await runner.performDLQAutoReprocess();

    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");

    const tv = await db.prepare("SELECT * FROM track_versions WHERE id = ?").get(versionId);
    assert.equal(tv.status, "processing");

    const track = await db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackId);
    assert.equal(track.status, "rendering");
  });
});
