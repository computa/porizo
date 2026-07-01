process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createDeadLetterQueueRepository,
  currentStepForJob,
  lastErrorForJob,
  maxRetriesForJob,
  retryCountForJob,
} = require("../src/database/dead-letter-queue-repository");

const now = "2026-06-27T00:00:00.000Z";

let db;
let repository;

async function createSqliteDatabase() {
  return getDatabase({
    provider: "sqlite",
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
}

async function seedCurrentTrackVersion(trackVersionId = "tv_dlq") {
  const userId = `user_${trackVersionId}`;
  const trackId = `track_${trackVersionId}`;
  await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(
    userId,
    now,
  );
  await db
    .prepare(
      `INSERT INTO tracks (id, user_id, status, title, latest_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(trackId, userId, "failed", "DLQ Test", 1, now, now);
  await db
    .prepare(
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(trackVersionId, trackId, 1, "failed", "preview", "hash", now);
}

async function insertCurrentJob({
  id = "job_current",
  status = "failed",
  step = "voice_convert",
  attempts = 2,
  maxAttempts = 3,
  errorCode = null,
  errorMessage = "Provider timeout",
} = {}) {
  await seedCurrentTrackVersion(`${id}_version`);
  await db
    .prepare(
      `INSERT INTO jobs (
         id, track_version_id, workflow_type, status, step, attempts,
         max_attempts, step_index, error_code, error_message, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `${id}_version`,
      "preview_render",
      status,
      step,
      attempts,
      maxAttempts,
      4,
      errorCode,
      errorMessage,
      now,
      now,
    );
}

async function resetToLegacySchema() {
  await db.prepare("PRAGMA foreign_keys = OFF").run();
  await db.prepare("DROP TABLE IF EXISTS dead_letter_queue").run();
  await db.prepare("DROP TABLE IF EXISTS jobs").run();
  await db
    .prepare(
      `CREATE TABLE jobs (
         id TEXT PRIMARY KEY,
         track_version_id TEXT,
         status TEXT DEFAULT 'pending',
         current_step TEXT,
         retry_count INTEGER DEFAULT 0,
         max_retries INTEGER DEFAULT 5,
         last_error TEXT,
         created_at TEXT DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT DEFAULT CURRENT_TIMESTAMP
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE dead_letter_queue (
         id TEXT PRIMARY KEY,
         job_id TEXT NOT NULL UNIQUE,
         original_status TEXT NOT NULL,
         failure_reason TEXT NOT NULL,
         failure_count INTEGER NOT NULL,
         last_error TEXT,
         moved_at TEXT DEFAULT CURRENT_TIMESTAMP,
         reprocessed_at TEXT,
         reprocess_job_id TEXT
       )`,
    )
    .run();
}

describe("DeadLetterQueueRepository current jobs schema", () => {
  beforeEach(async () => {
    db = await createSqliteDatabase();
    repository = createDeadLetterQueueRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("upsertEntry records current-schema attempts and error_message", async () => {
    await insertCurrentJob({
      id: "job_failed",
      attempts: 3,
      errorMessage: "Suno timeout",
    });
    const job = await repository.getJobById("job_failed");

    const entry = await repository.upsertEntry({
      id: "dlq_failed",
      job,
      jobId: "job_failed",
      reason: "Max attempts exceeded",
      failureCount: retryCountForJob(job),
      lastError: lastErrorForJob(job),
    });
    await repository.markJobDeadLetter("job_failed");

    assert.equal(entry.id, "dlq_failed");
    assert.equal(entry.failure_count, 3);
    assert.equal(entry.last_error, "Suno timeout");
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = ?").get("job_failed")
        .status,
      "dead_letter",
    );
  });

  test("createReprocessJob creates a queued current-schema job", async () => {
    await insertCurrentJob({
      id: "job_retry",
      step: "instrumental",
      maxAttempts: 4,
    });
    const originalJob = await repository.getJobById("job_retry");

    await repository.createReprocessJob({
      id: "job_retry_new",
      originalJob,
      startStep: currentStepForJob(originalJob),
    });

    assert.deepEqual(
      db
        .prepare(
          `SELECT workflow_type, status, step, attempts, max_attempts, step_index
           FROM jobs WHERE id = ?`,
        )
        .get("job_retry_new"),
      {
        workflow_type: "preview_render",
        status: "queued",
        step: "instrumental",
        attempts: 0,
        max_attempts: 4,
        step_index: 0,
      },
    );
  });

  test("listAutoReprocessCandidates joins retryable DLQ rows with job context", async () => {
    await insertCurrentJob({
      id: "job_auto_old",
      step: "voice_convert",
      errorCode: "E_PROVIDER",
      errorMessage: "provider timeout",
    });
    await insertCurrentJob({
      id: "job_auto_recent",
      step: "voice_convert",
      errorMessage: "recent failure",
    });
    await insertCurrentJob({
      id: "job_auto_maxed",
      step: "ready",
      errorMessage: "maxed failure",
    });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue (
           id, job_id, original_status, failure_reason, failure_count, moved_at,
           auto_reprocess_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "dlq_auto_old",
        "job_auto_old",
        "failed",
        "provider timeout",
        3,
        "2026-06-27T00:00:00.000Z",
        1,
      );
    await db
      .prepare(
        `INSERT INTO dead_letter_queue (
           id, job_id, original_status, failure_reason, failure_count, moved_at,
           auto_reprocess_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "dlq_auto_recent",
        "job_auto_recent",
        "failed",
        "recent failure",
        3,
        "2026-06-27T00:06:00.000Z",
        0,
      );
    await db
      .prepare(
        `INSERT INTO dead_letter_queue (
           id, job_id, original_status, failure_reason, failure_count, moved_at,
           auto_reprocess_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "dlq_auto_maxed",
        "job_auto_maxed",
        "failed",
        "maxed failure",
        3,
        "2026-06-27T00:00:00.000Z",
        2,
      );

    const candidates = await repository.listAutoReprocessCandidates({
      cooldownCutoff: "2026-06-27T00:05:00.000Z",
      limit: 5,
    });

    assert.deepEqual(
      candidates.map((candidate) => ({
        id: candidate.id,
        job_id: candidate.job_id,
        step: candidate.step,
        error_code: candidate.error_code,
        track_version_id: candidate.track_version_id,
        workflow_type: candidate.workflow_type,
      })),
      [
        {
          id: "dlq_auto_old",
          job_id: "job_auto_old",
          step: "voice_convert",
          error_code: "E_PROVIDER",
          track_version_id: "job_auto_old_version",
          workflow_type: "preview_render",
        },
      ],
    );
  });

  test("markAutoReprocessed timestamps the existing DLQ entry and increments attempts", async () => {
    await insertCurrentJob({ id: "job_auto_mark" });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue (
           id, job_id, original_status, failure_reason, failure_count, moved_at,
           auto_reprocess_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "dlq_auto_mark",
        "job_auto_mark",
        "failed",
        "provider timeout",
        3,
        now,
        1,
      );

    await repository.markAutoReprocessed({
      dlqId: "dlq_auto_mark",
      jobId: "job_auto_mark",
      now: "2026-06-27T00:10:00.000Z",
    });

    assert.deepEqual(
      db
        .prepare(
          "SELECT reprocessed_at, reprocess_job_id, auto_reprocess_count FROM dead_letter_queue WHERE id = ?",
        )
        .get("dlq_auto_mark"),
      {
        reprocessed_at: "2026-06-27T00:10:00.000Z",
        reprocess_job_id: "job_auto_mark",
        auto_reprocess_count: 2,
      },
    );
  });

  test("stats and purge are adapter-neutral", async () => {
    await insertCurrentJob({ id: "job_old" });
    await insertCurrentJob({ id: "job_new" });
    await db
      .prepare(
        `INSERT INTO dead_letter_queue (
           id, job_id, original_status, failure_reason, failure_count, moved_at,
           reprocessed_at, reprocess_job_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "dlq_old",
        "job_old",
        "failed",
        "old",
        1,
        now,
        "2026-06-01T00:00:00.000Z",
        null,
      );
    await db
      .prepare(
        `INSERT INTO dead_letter_queue (
           id, job_id, original_status, failure_reason, failure_count, moved_at,
           reprocessed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("dlq_new", "job_new", "failed", "new", 1, now, null);

    assert.equal(await repository.countEntries(), 2);
    assert.equal(await repository.countEntries({ unprocessedOnly: true }), 1);
    assert.equal(
      await repository.purgeReprocessedBefore("2026-06-10T00:00:00.000Z"),
      1,
    );
    assert.equal(await repository.countEntries(), 1);
  });
});

describe("DeadLetterQueueRepository legacy jobs schema", () => {
  beforeEach(async () => {
    db = await createSqliteDatabase();
    await resetToLegacySchema();
    repository = createDeadLetterQueueRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("field helpers preserve legacy retry and current_step semantics", async () => {
    await db
      .prepare(
        `INSERT INTO jobs (
           id, track_version_id, status, current_step, retry_count, max_retries, last_error
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "job_legacy",
        "tv_legacy",
        "failed",
        "music_gen",
        5,
        7,
        "Legacy provider timeout",
      );

    const job = await repository.getJobById("job_legacy");

    assert.equal(currentStepForJob(job), "music_gen");
    assert.equal(retryCountForJob(job), 5);
    assert.equal(maxRetriesForJob(job), 7);
    assert.equal(lastErrorForJob(job), "Legacy provider timeout");
  });

  test("createReprocessJob preserves legacy pending/current_step contract", async () => {
    await db
      .prepare(
        `INSERT INTO jobs (
           id, track_version_id, status, current_step, retry_count, max_retries
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("job_legacy", "tv_legacy", "failed", "voice_convert", 3, 6);

    const originalJob = await repository.getJobById("job_legacy");

    await repository.createReprocessJob({
      id: "job_legacy_new",
      originalJob,
      startStep: "music_gen",
    });

    assert.deepEqual(
      db
        .prepare(
          "SELECT status, current_step, retry_count, max_retries FROM jobs WHERE id = ?",
        )
        .get("job_legacy_new"),
      {
        status: "pending",
        current_step: "music_gen",
        retry_count: 0,
        max_retries: 6,
      },
    );
  });
});
