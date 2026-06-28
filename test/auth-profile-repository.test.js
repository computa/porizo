process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAuthProfileRepository,
} = require("../src/database/auth-profile-repository");

let db;
let repository;

async function seedUser({
  userId = "user_auth_profile",
  username = "profile_user",
  deletedAt = null,
} = {}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, username, display_name, risk_level, deleted_at, created_at)
       VALUES (?, ?, 1, ?, 'Auth Profile User', 'low', ?, ?)`,
    )
    .run(
      userId,
      `${userId}@example.com`,
      username,
      deletedAt,
      "2026-06-28T00:00:00.000Z",
    );
}

describe("AuthProfileRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAuthProfileRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findActiveUserByUsername ignores soft-deleted username rows", async () => {
    await seedUser({
      userId: "active_username_user",
      username: "available_check",
    });
    await seedUser({
      userId: "deleted_username_user",
      username: "deleted_check",
      deletedAt: "2026-06-28T01:00:00.000Z",
    });

    const active =
      await repository.findActiveUserByUsername("available_check");
    const deleted = await repository.findActiveUserByUsername("deleted_check");

    assert.deepEqual(active, { id: "active_username_user" });
    assert.equal(deleted, undefined);
  });
});
