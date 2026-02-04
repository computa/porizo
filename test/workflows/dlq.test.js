/**
 * Dead-Letter Queue (DLQ) Tests
 *
 * Tests the dead-letter queue for handling failed jobs that exceed retry limits.
 */

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { createDLQService } = require("../../src/workflows/dlq");
const { getDatabase } = require("../../src/database");

describe("Dead-Letter Queue", () => {
  let db;
  let dlq;
  let testDir;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "dlq-test-"));
    const dbPath = path.join(testDir, "test.db");

    // Use in-memory database without migrations for isolation
    db = await getDatabase({
      provider: 'sqlite',
      dbPath: ":memory:",
      migrationsDir: null, // Skip migrations
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
        status TEXT DEFAULT 'pending',
        current_step TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 5,
        last_error TEXT,
        error_data TEXT,
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

    dlq = createDLQService(db);
  });

  afterEach(async () => {
    if (db && db.close) {
      await db.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test("moveToDeadLetter adds job to DLQ", async () => {
    // Setup: Create test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id, status) VALUES ('tv1', 't1', 'failed')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, retry_count, max_retries, last_error)
      VALUES ('job1', 'tv1', 'failed', 5, 5, 'Provider timeout')
    `);

    // Act
    const dlqEntry = await dlq.moveToDeadLetter({
      jobId: "job1",
      reason: "Max retries exceeded",
    });

    // Assert
    assert.ok(dlqEntry.id);
    assert.strictEqual(dlqEntry.job_id, "job1");
    assert.strictEqual(dlqEntry.failure_reason, "Max retries exceeded");

    // Verify job status updated
    const job = await db.query("SELECT status FROM jobs WHERE id = 'job1'");
    assert.strictEqual(job.rows[0].status, "dead_letter");
  });

  test("listDeadLetters returns all DLQ entries", async () => {
    // Setup: Create test data
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1'), ('tv2', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, retry_count, max_retries)
      VALUES
        ('job1', 'tv1', 'failed', 5, 5),
        ('job2', 'tv2', 'failed', 5, 5)
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Reason 1" });
    await dlq.moveToDeadLetter({ jobId: "job2", reason: "Reason 2" });

    // Act
    const entries = await dlq.listDeadLetters();

    // Assert
    assert.strictEqual(entries.length, 2);
    assert.ok(entries.some((e) => e.job_id === "job1"));
    assert.ok(entries.some((e) => e.job_id === "job2"));
  });

  test("listDeadLetters filters by status", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1'), ('tv2', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, retry_count, max_retries)
      VALUES
        ('job1', 'tv1', 'failed', 5, 5),
        ('job2', 'tv2', 'failed', 5, 5)
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Reason 1" });
    await dlq.moveToDeadLetter({ jobId: "job2", reason: "Reason 2" });

    // Reprocess one
    await dlq.reprocess({ jobId: "job1" });

    // Act: List unprocessed only
    const entries = await dlq.listDeadLetters({ unprocessedOnly: true });

    // Assert
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].job_id, "job2");
  });

  test("getDeadLetter returns single entry with job details", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, current_step, last_error)
      VALUES ('job1', 'tv1', 'failed', 'voice_convert', 'API timeout')
    `);

    const dlqEntry = await dlq.moveToDeadLetter({ jobId: "job1", reason: "Max retries" });

    // Act
    const entry = await dlq.getDeadLetter(dlqEntry.id);

    // Assert
    assert.ok(entry);
    assert.strictEqual(entry.job_id, "job1");
    assert.strictEqual(entry.failure_reason, "Max retries");
    assert.ok(entry.job); // Should include job details
    assert.strictEqual(entry.job.current_step, "voice_convert");
  });

  test("reprocess creates new job and marks DLQ entry as reprocessed", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, current_step, retry_count)
      VALUES ('job1', 'tv1', 'failed', 'music_gen', 5)
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "API failure" });

    // Act
    const result = await dlq.reprocess({ jobId: "job1" });

    // Assert
    assert.ok(result.newJobId);
    assert.ok(result.dlqEntryId);

    // Verify new job was created
    const newJob = await db.query("SELECT * FROM jobs WHERE id = ?", [result.newJobId]);
    assert.strictEqual(newJob.rows.length, 1);
    assert.strictEqual(newJob.rows[0].status, "pending");
    assert.strictEqual(newJob.rows[0].retry_count, 0);

    // Verify DLQ entry was updated
    const dlqEntry = await db.query("SELECT * FROM dead_letter_queue WHERE job_id = 'job1'");
    assert.ok(dlqEntry.rows[0].reprocessed_at);
    assert.strictEqual(dlqEntry.rows[0].reprocess_job_id, result.newJobId);
  });

  test("reprocess with fromStep starts from specific step", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, current_step)
      VALUES ('job1', 'tv1', 'failed', 'voice_convert')
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Voice conversion failed" });

    // Act: Reprocess from a specific step
    const result = await dlq.reprocess({
      jobId: "job1",
      fromStep: "music_gen", // Go back further than where it failed
    });

    // Assert
    const newJob = await db.query("SELECT * FROM jobs WHERE id = ?", [result.newJobId]);
    assert.strictEqual(newJob.rows[0].current_step, "music_gen");
  });

  test("getStats returns DLQ statistics", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1'), ('tv2', 't1'), ('tv3', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status)
      VALUES ('job1', 'tv1', 'failed'), ('job2', 'tv2', 'failed'), ('job3', 'tv3', 'failed')
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Error 1" });
    await dlq.moveToDeadLetter({ jobId: "job2", reason: "Error 2" });
    await dlq.moveToDeadLetter({ jobId: "job3", reason: "Error 3" });

    await dlq.reprocess({ jobId: "job1" });

    // Act
    const stats = await dlq.getStats();

    // Assert
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.unprocessed, 2);
    assert.strictEqual(stats.reprocessed, 1);
  });

  test("purge removes old reprocessed entries", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1'), ('tv2', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status)
      VALUES ('job1', 'tv1', 'failed'), ('job2', 'tv2', 'failed')
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Error 1" });
    await dlq.moveToDeadLetter({ jobId: "job2", reason: "Error 2" });

    // Reprocess and simulate it being old by updating reprocessed_at
    await dlq.reprocess({ jobId: "job1" });

    // Make job1's entry look old
    await db.query(`
      UPDATE dead_letter_queue
      SET reprocessed_at = datetime('now', '-8 days')
      WHERE job_id = 'job1'
    `);

    // Act: Purge entries older than 7 days
    const purged = await dlq.purge({ olderThanDays: 7 });

    // Assert
    assert.strictEqual(purged.count, 1);

    const remaining = await dlq.listDeadLetters();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].job_id, "job2");
  });

  test("moveToDeadLetter captures error data", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status, last_error, error_data)
      VALUES ('job1', 'tv1', 'failed', 'API Error', '{"code": "E101", "details": "timeout"}')
    `);

    // Act
    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Max retries" });

    // Assert
    const entry = await db.query("SELECT * FROM dead_letter_queue WHERE job_id = 'job1'");
    assert.strictEqual(entry.rows[0].last_error, "API Error");
  });

  test("cannot reprocess already reprocessed entry", async () => {
    await db.query("INSERT INTO users (id, email) VALUES ('u1', 'test@test.com')");
    await db.query("INSERT INTO tracks (id, user_id, title) VALUES ('t1', 'u1', 'Test Track')");
    await db.query("INSERT INTO track_versions (id, track_id) VALUES ('tv1', 't1')");
    await db.query(`
      INSERT INTO jobs (id, track_version_id, status)
      VALUES ('job1', 'tv1', 'failed')
    `);

    await dlq.moveToDeadLetter({ jobId: "job1", reason: "Error" });
    await dlq.reprocess({ jobId: "job1" });

    // Act & Assert
    await assert.rejects(
      async () => dlq.reprocess({ jobId: "job1" }),
      /already been reprocessed/
    );
  });
});
