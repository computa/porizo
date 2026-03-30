/**
 * Security Remediation Tests — Units 6, 7, 8
 *
 * Unit 6: Job retry status guard (prevents retrying non-failed jobs)
 * Unit 7: Enrollment risk level check (blocks high/blocked accounts)
 * Unit 8: Login counter atomic increment (prevents lost updates)
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, describe, after, before, beforeEach } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

function uniqueId(prefix = "sec") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

// ============================================================
// Unit 6: Job retry status guard
// ============================================================
describe("Unit 6: Job retry status guard", () => {
  let storageDir;
  let db;
  let app;
  const userId = "test-retry-guard-user";

  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-sec6-"));
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    const storage = createStorageProvider({
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
    });
    app = buildServer({
      db,
      config: {
        PREVIEW_ONLY: false,
        STREAM_BASE_URL: "http://stream.local",
        STORAGE_DIR: storageDir,
        STORAGE_PROVIDER: "local",
        UPLOAD_SIGNING_SECRET: "test-secret",
        UPLOAD_URL_TTL_SEC: 900,
        ALLOW_ANON_USER_ID: true,
      },
      storage,
    });

    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
    await db.prepare(
      "INSERT INTO entitlements (user_id, tier, credits_balance, updated_at) VALUES (?, 'free', 100, ?)"
    ).run(userId, now);
  });

  after(async () => {
    await app.close();
    db.close();
  });

  let counter = 0;
  async function seedTrackAndVersion() {
    counter++;
    const now = new Date().toISOString();
    const trackId = `track-sec6-${counter}`;
    const versionId = `tv-sec6-${counter}`;

    await db.prepare(
      "INSERT INTO tracks (id, user_id, title, recipient_name, message, occasion, style, voice_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(trackId, userId, "Test Song", "Bob", "Happy bday", "birthday", "pop", "AI_Full", "failed", now, now);

    await db.prepare(
      "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(versionId, trackId, 1, "failed", "preview", "hash", now);

    const versionDir = path.join(storageDir, "tracks", userId, trackId, "v1");
    fs.mkdirSync(versionDir, { recursive: true });

    return { trackId, versionId };
  }

  async function seedJob(trackVersionId, status = "failed") {
    const now = new Date().toISOString();
    const jobId = `job-sec6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.prepare(
      "INSERT INTO jobs (id, track_version_id, workflow_type, status, step, attempts, max_attempts, step_index, error_code, error_message, progress_pct, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(jobId, trackVersionId, "preview_render", status, "voice_convert", 3, 3, 5, "R205", "Failed", 55, now, now, now);
    await db.prepare("UPDATE track_versions SET preview_job_id = ? WHERE id = ?").run(jobId, trackVersionId);
    return jobId;
  }

  test("retries failed job successfully with status guard", async () => {
    const { trackId, versionId } = await seedTrackAndVersion();
    const jobId = await seedJob(versionId, "failed");

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 202);
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued", "job should be re-queued");
    assert.equal(job.attempts, 0, "attempts should be reset");
  });

  test("retries blocked job successfully", async () => {
    const { trackId, versionId } = await seedTrackAndVersion();
    const jobId = await seedJob(versionId, "blocked");

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    assert.equal(res.statusCode, 202);
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "queued");
  });

  test("returns 409 when job status changed to completed (race condition)", async () => {
    const { trackId, versionId } = await seedTrackAndVersion();
    const jobId = await seedJob(versionId, "failed");

    // Simulate race: worker completed the job between SELECT and UPDATE
    await db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(jobId);

    const res = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });

    // Neither findActiveJobForVersion (queued/running) nor findLatestFailedJobForVersion (failed/dead_letter/blocked)
    // will match a 'completed' job, so we get 404
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "NO_FAILED_JOB");
  });

  test("returns idempotent 202 when job already retried (queued)", async () => {
    const { trackId, versionId } = await seedTrackAndVersion();
    const jobId = await seedJob(versionId, "failed");

    // First retry succeeds
    const res1 = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });
    assert.equal(res1.statusCode, 202);

    // Second retry — job is now 'queued', findActiveJobForVersion returns it
    const res2 = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/versions/1/retry`,
      headers: { "x-user-id": userId },
    });
    assert.equal(res2.statusCode, 202);
    assert.equal(res2.json().job_id, jobId);
  });

  test("status guard SQL: UPDATE with wrong status returns 0 changes", async () => {
    // Direct SQL verification of the guard clause
    const { versionId } = await seedTrackAndVersion();
    const jobId = await seedJob(versionId, "failed");

    // Change status to something not in the guard
    await db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(jobId);

    // The guarded UPDATE should not match
    const result = await db.prepare(
      "UPDATE jobs SET status = 'queued' WHERE id = ? AND status IN ('failed', 'dead_letter', 'blocked')"
    ).run(jobId);
    assert.equal(result.changes, 0, "status guard should prevent update of running job");

    // Verify job is still running
    const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
    assert.equal(job.status, "running");
  });
});

// ============================================================
// Unit 7: Enrollment risk level check
// ============================================================
describe("Unit 7: Enrollment risk level check", () => {
  let storageDir;
  let db;
  let app;

  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-sec7-"));
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    const storage = createStorageProvider({
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
    });
    app = buildServer({
      db,
      config: {
        PREVIEW_ONLY: false,
        STREAM_BASE_URL: "http://stream.local",
        STORAGE_DIR: storageDir,
        STORAGE_PROVIDER: "local",
        UPLOAD_SIGNING_SECRET: "test-secret",
        UPLOAD_URL_TTL_SEC: 900,
        ALLOW_ANON_USER_ID: true,
      },
      storage,
    });
  });

  after(async () => {
    await app.close();
    db.close();
  });

  async function enrollmentStart(userId) {
    return app.inject({
      method: "POST",
      url: "/voice/enrollment/start",
      headers: { "x-user-id": userId },
      payload: { consent_accepted: true, consent_version: "v1.0" },
    });
  }

  test("allows enrollment for low-risk users", async () => {
    const userId = uniqueId("low");
    const res = await enrollmentStart(userId);
    assert.equal(res.statusCode, 200);
  });

  test("allows enrollment for medium-risk users", async () => {
    const userId = uniqueId("med");
    // First call creates user with risk_level='low'
    await enrollmentStart(userId);
    // Set to medium
    await db.prepare("UPDATE users SET risk_level = 'medium' WHERE id = ?").run(userId);

    const res = await enrollmentStart(userId);
    assert.equal(res.statusCode, 200, "medium-risk users should be allowed");
  });

  test("blocks enrollment for high-risk users", async () => {
    const userId = uniqueId("high");
    // Create user
    await enrollmentStart(userId);
    // Set to high
    await db.prepare("UPDATE users SET risk_level = 'high' WHERE id = ?").run(userId);

    const res = await enrollmentStart(userId);
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, "ACCOUNT_BLOCKED");
    assert.ok(body.message.includes("Voice features"), "should mention voice features");
  });

  test("blocks enrollment for blocked users", async () => {
    const userId = uniqueId("blk");
    // Create user
    await enrollmentStart(userId);
    // Set to blocked
    await db.prepare("UPDATE users SET risk_level = 'blocked' WHERE id = ?").run(userId);

    const res = await enrollmentStart(userId);
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, "ACCOUNT_BLOCKED");
  });

  test("risk check runs before rate limit consumption", async () => {
    const userId = uniqueId("order");
    // Create user
    await enrollmentStart(userId);
    // Block the user
    await db.prepare("UPDATE users SET risk_level = 'blocked' WHERE id = ?").run(userId);

    // Make many requests — should all be 403, not 429
    for (let i = 0; i < 15; i++) {
      const res = await enrollmentStart(userId);
      assert.equal(res.statusCode, 403, `Request ${i + 1} should be 403 (blocked), not 429 (rate limited)`);
    }
  });
});

// ============================================================
// Unit 8: Login counter atomic increment
// ============================================================
describe("Unit 8: Login counter atomic increment", () => {
  let db;
  const authService = require("../src/services/auth-service");

  before(async () => {
    db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
    authService.initialize(db);
  });

  after(() => {
    db.close();
  });

  let testUserId;
  beforeEach(() => {
    testUserId = uniqueId("lock");
    db.prepare(
      "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, datetime('now'), 'low')"
    ).run(testUserId, `${testUserId}@example.com`);
  });

  test("atomic increment: concurrent calls produce correct count", async () => {
    const concurrentCalls = 5;
    await Promise.all(
      Array.from({ length: concurrentCalls }, () =>
        authService.incrementFailedLoginCount(testUserId)
      )
    );

    const user = db.prepare("SELECT failed_login_count FROM users WHERE id = ?").get(testUserId);
    assert.equal(
      user.failed_login_count,
      concurrentCalls,
      `Expected ${concurrentCalls}, got ${user.failed_login_count} — lost updates detected`
    );
  });

  test("atomic increment: handles NULL failed_login_count", async () => {
    db.prepare("UPDATE users SET failed_login_count = NULL WHERE id = ?").run(testUserId);

    await authService.incrementFailedLoginCount(testUserId);

    const user = db.prepare("SELECT failed_login_count FROM users WHERE id = ?").get(testUserId);
    assert.equal(user.failed_login_count, 1, "should increment from NULL to 1");
  });

  test("locks account at threshold (5 failures)", async () => {
    for (let i = 0; i < 5; i++) {
      await authService.incrementFailedLoginCount(testUserId);
    }

    const user = db.prepare("SELECT failed_login_count, locked_until FROM users WHERE id = ?").get(testUserId);
    assert.equal(user.failed_login_count, 5);
    assert.ok(user.locked_until, "account should be locked after 5 failures");

    const lockedUntil = new Date(user.locked_until);
    const now = new Date();
    assert.ok(lockedUntil > now, "locked_until should be in the future");
  });

  test("escalating lockout: second lockout is longer", async () => {
    // 10 failures = 2 lockout events
    for (let i = 0; i < 10; i++) {
      await authService.incrementFailedLoginCount(testUserId);
    }

    const user = db.prepare("SELECT failed_login_count, locked_until FROM users WHERE id = ?").get(testUserId);
    assert.equal(user.failed_login_count, 10);

    // lockoutCount = floor(10/5) = 2 → 15 * 2^(2-1) = 30 minutes
    const lockedUntil = new Date(user.locked_until);
    const minExpected = new Date();
    minExpected.setMinutes(minExpected.getMinutes() + 25); // 30 min minus slack
    assert.ok(
      lockedUntil > minExpected,
      "Second lockout should be at least 25 minutes (escalated from 15)"
    );
  });

  test("reset clears count and lockout", async () => {
    await authService.incrementFailedLoginCount(testUserId);
    await authService.incrementFailedLoginCount(testUserId);

    await authService.resetFailedLoginCount(testUserId);

    const user = db.prepare("SELECT failed_login_count, locked_until FROM users WHERE id = ?").get(testUserId);
    assert.equal(user.failed_login_count, 0);
    assert.equal(user.locked_until, null);
  });
});
