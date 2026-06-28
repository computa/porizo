process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAuthRefreshTokenRepository,
} = require("../src/database/auth-refresh-token-repository");

let db;
let repository;

async function seedUser(userId = "user_refresh_repo") {
  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
       VALUES (?, ?, 1, 'Refresh Repo User', 'low', ?)`,
    )
    .run(userId, `${userId}@example.com`, "2026-06-28T00:00:00.000Z");
}

async function seedSession({
  sessionId = "sess_refresh_repo",
  userId = "user_refresh_repo",
  revokedAt = null,
} = {}) {
  await db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, device_name, last_active_at, revoked_at, created_at)
       VALUES (?, ?, 'Repo Device', ?, ?, ?)`,
    )
    .run(
      sessionId,
      userId,
      "2026-06-28T00:00:00.000Z",
      revokedAt,
      "2026-06-28T00:00:00.000Z",
    );
}

describe("AuthRefreshTokenRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAuthRefreshTokenRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findTokenForVerification returns family and session state", async () => {
    await seedUser();
    await seedSession();
    await repository.insertTokenFamily({
      id: "tf_refresh_repo",
      userId: "user_refresh_repo",
      sessionId: "sess_refresh_repo",
    });
    await repository.insertRefreshToken({
      id: "rt_refresh_repo",
      userId: "user_refresh_repo",
      tokenHash: "hash_refresh_repo",
      tokenFamily: "tf_refresh_repo",
      generation: 1,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    const token =
      await repository.findTokenForVerification("hash_refresh_repo");

    assert.equal(token.id, "rt_refresh_repo");
    assert.equal(token.user_id, "user_refresh_repo");
    assert.equal(token.token_family, "tf_refresh_repo");
    assert.equal(token.session_id, "sess_refresh_repo");
    assert.equal(token.session_revoked_at, null);
  });

  test("revocation and replacement helpers update only active rows", async () => {
    await seedUser();
    await seedSession();
    await repository.insertTokenFamily({
      id: "tf_rotation_repo",
      userId: "user_refresh_repo",
      sessionId: "sess_refresh_repo",
    });
    await repository.insertRefreshToken({
      id: "rt_old_repo",
      userId: "user_refresh_repo",
      tokenHash: "hash_old_repo",
      tokenFamily: "tf_rotation_repo",
      generation: 1,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    await repository.insertRefreshToken({
      id: "rt_new_repo",
      userId: "user_refresh_repo",
      tokenHash: "hash_new_repo",
      tokenFamily: "tf_rotation_repo",
      generation: 2,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    const revokeResult = await repository.revokeActiveToken("rt_old_repo");
    assert.equal(revokeResult.changes, 1);

    const secondRevoke = await repository.revokeActiveToken("rt_old_repo");
    assert.equal(secondRevoke.changes, 0);

    const replacement = await repository.findActiveReplacementToken({
      tokenFamily: "tf_rotation_repo",
      generation: 2,
    });
    assert.equal(replacement.id, "rt_new_repo");
  });

  test("compromise helpers mark families and revoke all tokens in the family", async () => {
    await seedUser();
    await seedSession();
    await repository.insertTokenFamily({
      id: "tf_compromise_repo",
      userId: "user_refresh_repo",
      sessionId: "sess_refresh_repo",
    });
    await repository.insertRefreshToken({
      id: "rt_compromise_1",
      userId: "user_refresh_repo",
      tokenHash: "hash_compromise_1",
      tokenFamily: "tf_compromise_repo",
      generation: 1,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    await repository.insertRefreshToken({
      id: "rt_compromise_2",
      userId: "user_refresh_repo",
      tokenHash: "hash_compromise_2",
      tokenFamily: "tf_compromise_repo",
      generation: 2,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    await repository.compromiseTokenFamily("tf_compromise_repo");
    await repository.revokeTokensInFamily("tf_compromise_repo");

    const family = await db
      .prepare("SELECT compromised_at FROM token_families WHERE id = ?")
      .get("tf_compromise_repo");
    assert.match(family.compromised_at, /^\d{4}-\d{2}-\d{2}/);

    const activeCount = await db
      .prepare(
        "SELECT COUNT(*) as count FROM refresh_tokens WHERE token_family = ? AND revoked_at IS NULL",
      )
      .get("tf_compromise_repo");
    assert.equal(activeCount.count, 0);
  });

  test("insertGraceUnrevokeAuditLog stores high-severity metadata", async () => {
    await seedUser();

    await repository.insertGraceUnrevokeAuditLog({
      id: "audit_refresh_repo",
      userId: "user_refresh_repo",
      tokenId: "rt_audit_repo",
      tokenFamily: "tf_audit_repo",
      generation: 3,
      timeSinceRevocationMs: 1234,
      createdAt: "2026-06-28T01:00:00.000Z",
    });

    const row = await db
      .prepare("SELECT action, resource_type, metadata_json FROM audit_logs WHERE id = ?")
      .get("audit_refresh_repo");
    assert.equal(row.action, "refresh_token_grace_unrevoke");
    assert.equal(row.resource_type, "refresh_token");

    const metadata = JSON.parse(row.metadata_json);
    assert.equal(metadata.severity, "HIGH");
    assert.equal(metadata.time_since_revocation_ms, 1234);
    assert.equal(metadata.token_family, "tf_audit_repo");
  });

  test("transaction rolls back refresh-token mutations on error", async () => {
    await seedUser();
    await assert.rejects(
      () =>
        repository.transaction(async (txRepository) => {
          await txRepository.insertTokenFamily({
            id: "tf_rollback_repo",
            userId: "user_refresh_repo",
          });
          throw new Error("force rollback");
        }),
      /force rollback/,
    );

    const family = await db
      .prepare("SELECT id FROM token_families WHERE id = ?")
      .get("tf_rollback_repo");
    assert.equal(family, undefined);
  });
});
