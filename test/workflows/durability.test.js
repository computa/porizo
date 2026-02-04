/**
 * Job Durability Tests
 *
 * Tests the integration of circuit breaker and DLQ with the job runner.
 */

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { createJobDurabilityService } = require("../../src/workflows/durability");
const { CircuitBreaker } = require("../../src/workflows/circuit-breaker");
const { createDLQService } = require("../../src/workflows/dlq");
const { getDatabase } = require("../../src/database");

describe("Job Durability", () => {
  let db;
  let durability;
  let circuitBreaker;
  let dlq;
  let testDir;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "durability-test-"));

    // Use in-memory database without migrations for isolation
    db = await getDatabase({
      provider: 'sqlite',
      dbPath: ":memory:",
      migrationsDir: null,
    });

    // Create minimal schema for testing
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        title TEXT,
        recipient_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS track_versions (
        id TEXT PRIMARY KEY,
        track_id TEXT REFERENCES tracks(id),
        version_num INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        track_version_id TEXT REFERENCES track_versions(id),
        workflow_type TEXT DEFAULT 'preview_render',
        status TEXT DEFAULT 'queued',
        step TEXT,
        step_index INTEGER DEFAULT 0,
        step_data TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        error_code TEXT,
        error_message TEXT,
        last_heartbeat_at TEXT,
        locked_by TEXT,
        locked_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        original_status TEXT NOT NULL,
        failure_reason TEXT NOT NULL,
        failure_count INTEGER NOT NULL,
        last_error TEXT,
        moved_at TEXT DEFAULT CURRENT_TIMESTAMP,
        reprocessed_at TEXT,
        reprocess_job_id TEXT
      )
    `);

    circuitBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
    dlq = createDLQService(db);
    durability = createJobDurabilityService({ db, circuitBreaker, dlq });
  });

  afterEach(async () => {
    if (db && db.close) {
      await db.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test("executeWithDurability succeeds when function succeeds", async () => {
    let called = false;
    const result = await durability.executeWithDurability({
      provider: "elevenlabs",
      fn: async () => {
        called = true;
        return { success: true };
      },
    });

    assert.strictEqual(called, true);
    assert.deepStrictEqual(result, { success: true });
  });

  test("executeWithDurability records circuit breaker success", async () => {
    // Record some failures first
    await circuitBreaker.recordFailure("elevenlabs");
    await circuitBreaker.recordFailure("elevenlabs");

    // Execute successful call
    await durability.executeWithDurability({
      provider: "elevenlabs",
      fn: async () => ({ ok: true }),
    });

    // Failures should be reset
    const stats = circuitBreaker.getStats("elevenlabs");
    assert.strictEqual(stats.failures, 0);
  });

  test("executeWithDurability records circuit breaker failure", async () => {
    await assert.rejects(
      async () => {
        await durability.executeWithDurability({
          provider: "elevenlabs",
          fn: async () => {
            throw new Error("API timeout");
          },
        });
      },
      /API timeout/
    );

    const stats = circuitBreaker.getStats("elevenlabs");
    assert.strictEqual(stats.failures, 1);
  });

  test("executeWithDurability blocks when circuit is open", async () => {
    // Open the circuit
    circuitBreaker.forceOpen("elevenlabs");

    await assert.rejects(
      async () => {
        await durability.executeWithDurability({
          provider: "elevenlabs",
          fn: async () => ({ ok: true }),
        });
      },
      /Circuit breaker open/
    );
  });

  test("moveFailedJobToDLQ moves job to dead letter queue", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id, status) VALUES ('tv1', 't1', 'failed')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, attempts, max_attempts, error_message)
      VALUES ('job1', 'tv1', 'failed', 3, 3, 'Provider timeout')
    `);

    // Act
    const dlqEntry = await durability.moveFailedJobToDLQ({
      jobId: "job1",
      reason: "Max attempts exceeded",
    });

    // Assert
    assert.ok(dlqEntry.id);
    assert.strictEqual(dlqEntry.job_id, "job1");
    assert.strictEqual(dlqEntry.failure_reason, "Max attempts exceeded");

    // Verify job status updated
    const job = await db.query("SELECT status FROM jobs WHERE id = 'job1'");
    assert.strictEqual(job.rows[0].status, "dead_letter");
  });

  test("shouldMoveToDLQ returns true when max attempts exceeded", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, attempts, max_attempts)
      VALUES ('job1', 'tv1', 'failed', 3, 3)
    `);

    const shouldMove = await durability.shouldMoveToDLQ("job1");
    assert.strictEqual(shouldMove, true);
  });

  test("shouldMoveToDLQ returns false when attempts remaining", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, attempts, max_attempts)
      VALUES ('job1', 'tv1', 'queued', 1, 3)
    `);

    const shouldMove = await durability.shouldMoveToDLQ("job1");
    assert.strictEqual(shouldMove, false);
  });

  test("saveCheckpoint updates job step_data", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, step, step_index)
      VALUES ('job1', 'tv1', 'running', 'lyrics', 1)
    `);

    // Act
    await durability.saveCheckpoint({
      jobId: "job1",
      step: "lyrics",
      data: { lyrics_json: '{"verse1": "test"}' },
    });

    // Assert
    const job = await db.query("SELECT step_data FROM jobs WHERE id = 'job1'");
    const stepData = JSON.parse(job.rows[0].step_data);
    assert.deepStrictEqual(stepData.lyrics, { lyrics_json: '{"verse1": "test"}' });
  });

  test("saveCheckpoint accumulates data from multiple steps", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, step_data)
      VALUES ('job1', 'tv1', 'running', '{"moderation": {"passed": true}}')
    `);

    // Act - save another checkpoint
    await durability.saveCheckpoint({
      jobId: "job1",
      step: "lyrics",
      data: { generated: true },
    });

    // Assert - should have both steps
    const job = await db.query("SELECT step_data FROM jobs WHERE id = 'job1'");
    const stepData = JSON.parse(job.rows[0].step_data);
    assert.deepStrictEqual(stepData.moderation, { passed: true });
    assert.deepStrictEqual(stepData.lyrics, { generated: true });
  });

  test("updateHeartbeat updates last_heartbeat_at", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, last_heartbeat_at)
      VALUES ('job1', 'tv1', 'running', '2020-01-01T00:00:00.000Z')
    `);

    // Act
    await durability.updateHeartbeat("job1");

    // Assert - heartbeat should be recent
    const job = await db.query("SELECT last_heartbeat_at FROM jobs WHERE id = 'job1'");
    const heartbeat = new Date(job.rows[0].last_heartbeat_at);
    const now = new Date();
    const diffMs = now - heartbeat;
    assert.ok(diffMs < 5000, "Heartbeat should be within 5 seconds of now");
  });

  test("recoverStaleJobs requeues stuck jobs", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");

    // Create a job that has been stuck in 'running' for a long time
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, last_heartbeat_at, locked_by)
      VALUES ('job1', 'tv1', 'running', ?, 'old-worker')
    `, [oldTime]);

    // Act - recover with 5 minute threshold
    const recovered = await durability.recoverStaleJobs({ staleThresholdMinutes: 5 });

    // Assert
    assert.strictEqual(recovered, 1);

    // Verify job is requeued
    const job = await db.query("SELECT status, locked_by FROM jobs WHERE id = 'job1'");
    assert.strictEqual(job.rows[0].status, "queued");
    assert.strictEqual(job.rows[0].locked_by, null);
  });

  test("recoverStaleJobs does not affect recent jobs", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");

    // Create a job that has a recent heartbeat
    const recentTime = new Date(Date.now() - 1 * 60 * 1000).toISOString(); // 1 minute ago
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, last_heartbeat_at, locked_by)
      VALUES ('job1', 'tv1', 'running', ?, 'current-worker')
    `, [recentTime]);

    // Act - recover with 5 minute threshold
    const recovered = await durability.recoverStaleJobs({ staleThresholdMinutes: 5 });

    // Assert - no jobs recovered
    assert.strictEqual(recovered, 0);

    // Verify job is still running
    const job = await db.query("SELECT status, locked_by FROM jobs WHERE id = 'job1'");
    assert.strictEqual(job.rows[0].status, "running");
    assert.strictEqual(job.rows[0].locked_by, "current-worker");
  });

  test("getJobHealth returns health status", async () => {
    // Setup test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, step, step_index, attempts, max_attempts)
      VALUES ('job1', 'tv1', 'running', 'lyrics', 2, 1, 3)
    `);

    // Act
    const health = await durability.getJobHealth("job1");

    // Assert
    assert.strictEqual(health.status, "running");
    assert.strictEqual(health.currentStep, "lyrics");
    assert.strictEqual(health.stepIndex, 2);
    assert.strictEqual(health.attempts, 1);
    assert.strictEqual(health.maxAttempts, 3);
    assert.strictEqual(health.attemptsRemaining, 2);
  });
});
