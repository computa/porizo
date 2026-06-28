process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAuthCredentialRepository,
} = require("../src/database/auth-credential-repository");

let db;
let repository;

async function seedUser({ userId = "user_auth_credential" } = {}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
       VALUES (?, ?, 1, 'Auth Credential User', 'low', ?)`,
    )
    .run(
      userId,
      `${userId}@example.com`,
      "2026-06-28T00:00:00.000Z",
    );
}

describe("AuthCredentialRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAuthCredentialRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("createPasswordCredential stores the route-supplied hash and timestamp", async () => {
    await seedUser();

    await repository.createPasswordCredential({
      userId: "user_auth_credential",
      passwordHash: "hash-v1",
      createdAt: "2026-06-28T01:00:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT user_id, password_hash, created_at FROM user_credentials WHERE user_id = ?",
      )
      .get("user_auth_credential");
    assert.deepEqual(row, {
      user_id: "user_auth_credential",
      password_hash: "hash-v1",
      created_at: "2026-06-28T01:00:00.000Z",
    });
  });

  test("findPasswordCredential returns only the password hash", async () => {
    await seedUser();
    await repository.createPasswordCredential({
      userId: "user_auth_credential",
      passwordHash: "hash-v1",
      createdAt: "2026-06-28T01:00:00.000Z",
    });

    const credential =
      await repository.findPasswordCredential("user_auth_credential");

    assert.deepEqual(credential, { password_hash: "hash-v1" });
  });

  test("updatePasswordCredential updates hash and stamps password_changed_at", async () => {
    await seedUser();
    await repository.createPasswordCredential({
      userId: "user_auth_credential",
      passwordHash: "hash-v1",
      createdAt: "2026-06-28T01:00:00.000Z",
    });

    await repository.updatePasswordCredential(
      "user_auth_credential",
      "hash-v2",
    );

    const row = await db
      .prepare(
        "SELECT password_hash, password_changed_at FROM user_credentials WHERE user_id = ?",
      )
      .get("user_auth_credential");
    assert.equal(row.password_hash, "hash-v2");
    assert.match(row.password_changed_at, /^\d{4}-\d{2}-\d{2}/);
  });
});
