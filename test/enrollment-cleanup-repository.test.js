process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createEnrollmentCleanupRepository,
} = require("../src/database/enrollment-cleanup-repository");

let db;
let repository;

async function seedUser(userId) {
  await db
    .prepare(
      "INSERT INTO users (id, email, created_at, risk_level) VALUES (?, ?, ?, 'low')",
    )
    .run(userId, `${userId}@example.com`, "2026-06-20T09:00:00.000Z");
}

async function seedEnrollmentSession({
  id,
  userId,
  startedAt,
  promptsJson = null,
  chunkCount = 0,
}) {
  await db
    .prepare(
      `INSERT INTO enrollment_sessions (
        id, user_id, status, prompts_json, chunk_count, started_at, expires_at
      ) VALUES (?, ?, 'recording', ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      promptsJson,
      chunkCount,
      startedAt,
      "2026-06-30T09:00:00.000Z",
    );
}

describe("EnrollmentCleanupRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createEnrollmentCleanupRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listSessionsStartedBefore returns only sessions older than the cutoff", async () => {
    await seedUser("user_cleanup");
    const promptsJson = JSON.stringify([{ id: "p1" }, { id: "p2" }]);
    await seedEnrollmentSession({
      id: "enroll_old",
      userId: "user_cleanup",
      startedAt: "2026-06-19T09:00:00.000Z",
      promptsJson,
      chunkCount: 2,
    });
    await seedEnrollmentSession({
      id: "enroll_new",
      userId: "user_cleanup",
      startedAt: "2026-06-22T09:00:00.000Z",
      chunkCount: 1,
    });

    const rows = await repository.listSessionsStartedBefore(
      "2026-06-21T00:00:00.000Z",
    );

    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      ["enroll_old"],
    );
    assert.equal(rows[0].user_id, "user_cleanup");
    assert.equal(rows[0].prompts_json, promptsJson);
    assert.equal(rows[0].chunk_count, 2);
  });

  test("deleteSessionById deletes only the requested enrollment session", async () => {
    await seedUser("user_cleanup");
    await seedEnrollmentSession({
      id: "enroll_delete",
      userId: "user_cleanup",
      startedAt: "2026-06-19T09:00:00.000Z",
    });
    await seedEnrollmentSession({
      id: "enroll_keep",
      userId: "user_cleanup",
      startedAt: "2026-06-19T09:00:00.000Z",
    });

    const result = await repository.deleteSessionById("enroll_delete");

    assert.equal(result.changes, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM enrollment_sessions WHERE id = ?").get(
        "enroll_delete",
      ).count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM enrollment_sessions WHERE id = ?").get(
        "enroll_keep",
      ).count,
      1,
    );
  });
});
