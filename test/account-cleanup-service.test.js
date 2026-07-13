process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAccountCleanupRepository,
} = require("../src/database/account-cleanup-repository");
const {
  createAccountCleanupService,
} = require("../src/services/account-cleanup-service");

describe("account cleanup service", () => {
  let db;
  let repository;
  let currentTime;
  let idSequence;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAccountCleanupRepository(db);
    currentTime = new Date("2026-07-11T01:00:00.000Z");
    idSequence = 0;
  });

  afterEach(async () => {
    await db.close?.();
  });

  function service(overrides = {}) {
    return createAccountCleanupService({
      repository,
      logger: null,
      now: () => new Date(currentTime),
      createId: () => `cleanup_${++idSequence}`,
      leaseMs: 10_000,
      baseBackoffMs: 1_000,
      maxBackoffMs: 4_000,
      ...overrides,
    });
  }

  test("enqueue is idempotent and persists pending work", async () => {
    const cleanup = service();
    const first = await cleanup.enqueue({ userId: "user_1" });
    const duplicate = await cleanup.enqueue({ userId: "user_1" });

    assert.equal(first.id, "cleanup_1");
    assert.equal(duplicate.id, first.id);
    assert.equal(first.status, "pending");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM account_cleanup_jobs").get().count,
      1,
    );
  });

  test("claims once and completes through an idempotent processing seam", async () => {
    const processed = [];
    const cleanup = service({
      processCleanup: async (job) => processed.push(job.user_id),
    });
    await cleanup.enqueue({ userId: "user_2" });

    const claimed = await repository.claimNext({
      workerId: "worker_a",
      now: currentTime.toISOString(),
      leaseExpiresAt: new Date(currentTime.getTime() + 10_000).toISOString(),
    });
    assert.equal(claimed.lease_owner, "worker_a");
    assert.equal(
      await repository.claimNext({
        workerId: "worker_b",
        now: currentTime.toISOString(),
        leaseExpiresAt: new Date(currentTime.getTime() + 10_000).toISOString(),
      }),
      null,
    );
    await repository.markRetry({
      jobId: claimed.id,
      workerId: "worker_a",
      nextAttemptAt: currentTime.toISOString(),
      error: "simulated handoff",
      now: currentTime.toISOString(),
    });
    const first = await cleanup.processNext({ workerId: "worker_b" });

    assert.equal(first.status, "completed");
    assert.deepEqual(processed, ["user_2"]);
    const job = await repository.findById("cleanup_1");
    assert.equal(job.status, "completed");
    assert.equal(job.attempt_count, 2);
    assert.equal(job.lease_owner, null);
    assert.ok(job.completed_at);
    assert.equal(await cleanup.processNext({ workerId: "worker_c" }), null);
  });

  test("failure retries with bounded exponential backoff then becomes terminal", async () => {
    const cleanup = service({
      maxAttempts: 4,
      processCleanup: async () => {
        throw new Error("storage unavailable");
      },
    });
    await cleanup.enqueue({ userId: "user_3" });

    for (const expectedDelay of [1_000, 2_000, 4_000]) {
      const result = await cleanup.processNext({ workerId: "worker_retry" });
      assert.equal(result.status, "retry");
      assert.equal(
        new Date(result.nextAttemptAt).getTime() - currentTime.getTime(),
        expectedDelay,
      );
      assert.equal(await cleanup.processNext({ workerId: "worker_early" }), null);
      currentTime = new Date(result.nextAttemptAt);
    }

    const terminal = await cleanup.processNext({ workerId: "worker_retry" });
    assert.equal(terminal.status, "failed");
    const job = await repository.findById("cleanup_1");
    assert.equal(job.status, "failed");
    assert.equal(job.attempt_count, 4);
    assert.equal(job.next_attempt_at, null);
    assert.match(job.last_error, /storage unavailable/);
  });

  test("expired leases recover and stale owners cannot finish the job", async () => {
    await service().enqueue({ userId: "user_4" });
    const first = await repository.claimNext({
      workerId: "worker_stale",
      now: currentTime.toISOString(),
      leaseExpiresAt: new Date(currentTime.getTime() + 1_000).toISOString(),
    });
    assert.equal(first.attempt_count, 1);

    currentTime = new Date(currentTime.getTime() + 1_001);
    const recovered = await repository.claimNext({
      workerId: "worker_recovery",
      now: currentTime.toISOString(),
      leaseExpiresAt: new Date(currentTime.getTime() + 10_000).toISOString(),
    });
    assert.equal(recovered.id, first.id);
    assert.equal(recovered.attempt_count, 2);
    assert.equal(recovered.lease_owner, "worker_recovery");
    assert.equal(
      (await repository.markCompleted({
        jobId: first.id,
        workerId: "worker_stale",
        now: currentTime.toISOString(),
      })).changes,
      0,
    );
  });

  test("an expired final lease becomes an observable failed job", async () => {
    await service({ maxAttempts: 1 }).enqueue({ userId: "user_5" });
    await repository.claimNext({
      workerId: "worker_crashed",
      now: currentTime.toISOString(),
      leaseExpiresAt: new Date(currentTime.getTime() + 1_000).toISOString(),
    });
    currentTime = new Date(currentTime.getTime() + 1_001);

    assert.equal(
      await repository.claimNext({
        workerId: "worker_new",
        now: currentTime.toISOString(),
        leaseExpiresAt: new Date(currentTime.getTime() + 10_000).toISOString(),
      }),
      null,
    );
    const job = await repository.findById("cleanup_1");
    assert.equal(job.status, "failed");
    assert.match(job.last_error, /lease expired/i);
  });
});
