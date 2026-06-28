process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAuthOneTimeTokenRepository,
} = require("../src/database/auth-one-time-token-repository");

let db;
let repository;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function seedUser({ userId = "user_one_time_token" } = {}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
       VALUES (?, ?, 1, 'Auth Token User', 'low', ?)`,
    )
    .run(userId, `${userId}@example.com`, "2026-06-28T00:00:00.000Z");
}

describe("AuthOneTimeTokenRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAuthOneTimeTokenRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("consumeOneTimeToken returns and atomically marks password reset token used", async () => {
    await seedUser();
    const tokenHash = hashToken("reset-token");

    await repository.insertPasswordResetToken({
      id: "prt_one_time",
      userId: "user_one_time_token",
      tokenHash,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    const token = await repository.consumeOneTimeToken({
      tokenType: "password_reset",
      tokenHash,
    });

    assert.equal(token.id, "prt_one_time");
    assert.equal(token.user_id, "user_one_time_token");

    const row = await db
      .prepare("SELECT used_at FROM password_reset_tokens WHERE id = ?")
      .get("prt_one_time");
    assert.match(row.used_at, /^\d{4}-\d{2}-\d{2}/);
  });

  test("consumeOneTimeToken preserves email verification target fields", async () => {
    await seedUser();
    const tokenHash = hashToken("email-token");

    await repository.insertEmailVerificationToken({
      id: "evt_one_time",
      userId: "user_one_time_token",
      tokenHash,
      expiresAt: "2999-01-01T00:00:00.000Z",
      emailNormalized: "new@example.com",
    });

    const token = await repository.consumeOneTimeToken({
      tokenType: "email_verification",
      tokenHash,
    });

    assert.equal(token.id, "evt_one_time");
    assert.equal(token.email_normalized, "new@example.com");
  });

  test("consumeOneTimeToken rejects already-used tokens", async () => {
    await seedUser();
    const tokenHash = hashToken("used-token");

    await repository.insertPasswordResetToken({
      id: "prt_used",
      userId: "user_one_time_token",
      tokenHash,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    await repository.markTokenUsed({
      tokenType: "password_reset",
      tokenId: "prt_used",
    });

    await assert.rejects(
      () =>
        repository.consumeOneTimeToken({
          tokenType: "password_reset",
          tokenHash,
        }),
      /already been used/i,
    );
  });

  test("invalidateActiveTokensForUser marks only active tokens for that user", async () => {
    await seedUser();
    await seedUser({ userId: "other_one_time_user" });

    await repository.insertPasswordResetToken({
      id: "prt_active",
      userId: "user_one_time_token",
      tokenHash: hashToken("active-token"),
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    await repository.insertPasswordResetToken({
      id: "prt_other",
      userId: "other_one_time_user",
      tokenHash: hashToken("other-token"),
      expiresAt: "2999-01-01T00:00:00.000Z",
    });

    await repository.invalidateActiveTokensForUser({
      tokenType: "password_reset",
      userId: "user_one_time_token",
    });

    const rows = await db
      .prepare(
        "SELECT id, used_at FROM password_reset_tokens ORDER BY id",
      )
      .all();

    assert.equal(rows.find((row) => row.id === "prt_active").used_at !== null, true);
    assert.equal(rows.find((row) => row.id === "prt_other").used_at, null);
  });

  test("invalid token type is rejected before SQL construction", async () => {
    await assert.rejects(
      () =>
        repository.consumeOneTimeToken({
          tokenType: "bad_table",
          tokenHash: "hash",
        }),
      /invalid token type/i,
    );
  });
});
