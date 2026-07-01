process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createUserEmailPreferencesRepository,
} = require("../src/database/user-email-preferences-repository");

let db;
let repository;

async function seedUser({ id, unsubscribedAt = null } = {}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, unsubscribed_at, created_at, risk_level)
       VALUES (?, ?, ?, ?, 'low')`,
    )
    .run(
      id,
      `${id}@example.com`,
      unsubscribedAt,
      "2026-06-27T09:00:00.000Z",
    );
}

async function getUnsubscribedAt(userId) {
  return db
    .prepare("SELECT unsubscribed_at FROM users WHERE id = ?")
    .get(userId)?.unsubscribed_at;
}

describe("UserEmailPreferencesRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createUserEmailPreferencesRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("markLifecycleEmailsUnsubscribed sets unsubscribed_at when it is null", async () => {
    await seedUser({ id: "user_unsub_new" });

    const result = await repository.markLifecycleEmailsUnsubscribed({
      userId: "user_unsub_new",
      unsubscribedAt: "2026-06-27T10:00:00.000Z",
    });

    assert.equal(result.changes, 1);
    assert.equal(
      await getUnsubscribedAt("user_unsub_new"),
      "2026-06-27T10:00:00.000Z",
    );
  });

  test("markLifecycleEmailsUnsubscribed preserves the first unsubscribe timestamp", async () => {
    await seedUser({
      id: "user_unsub_existing",
      unsubscribedAt: "2026-06-27T09:30:00.000Z",
    });

    const result = await repository.markLifecycleEmailsUnsubscribed({
      userId: "user_unsub_existing",
      unsubscribedAt: "2026-06-27T10:00:00.000Z",
    });

    assert.equal(result.changes, 1);
    assert.equal(
      await getUnsubscribedAt("user_unsub_existing"),
      "2026-06-27T09:30:00.000Z",
    );
  });

  test("markLifecycleEmailsUnsubscribed does not expose whether a missing user exists", async () => {
    const result = await repository.markLifecycleEmailsUnsubscribed({
      userId: "missing_user",
      unsubscribedAt: "2026-06-27T10:00:00.000Z",
    });

    assert.equal(result.changes, 0);
  });
});
