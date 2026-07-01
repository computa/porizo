process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAuthSecurityRepository,
} = require("../src/database/auth-security-repository");

let db;
let repository;

async function seedUser({ userId = "user_auth_security" } = {}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
       VALUES (?, ?, 1, 'Auth Security User', 'low', ?)`,
    )
    .run(
      userId,
      `${userId}@example.com`,
      "2026-06-28T00:00:00.000Z",
    );
}

describe("AuthSecurityRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAuthSecurityRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("insertAuthEvent stores auth event request context", async () => {
    await seedUser();

    await repository.insertAuthEvent({
      id: "evt_auth_security",
      userId: "user_auth_security",
      eventType: "login_success",
      ipAddress: "203.0.113.10",
      userAgent: "Porizo/1.0",
      metadataJson: JSON.stringify({ session_id: "sess_1" }),
    });

    const row = await db
      .prepare(
        "SELECT user_id, event_type, ip_address, user_agent, metadata FROM auth_events WHERE id = ?",
      )
      .get("evt_auth_security");

    assert.deepEqual(row, {
      user_id: "user_auth_security",
      event_type: "login_success",
      ip_address: "203.0.113.10",
      user_agent: "Porizo/1.0",
      metadata: JSON.stringify({ session_id: "sess_1" }),
    });
  });

  test("incrementFailedLoginCount atomically increments from null", async () => {
    await seedUser();
    await db
      .prepare("UPDATE users SET failed_login_count = NULL WHERE id = ?")
      .run("user_auth_security");

    await repository.incrementFailedLoginCount("user_auth_security");

    const state =
      await repository.findLoginLockoutState("user_auth_security");
    assert.equal(state.failed_login_count, 1);
  });

  test("setAccountLockedUntil and resetFailedLoginCount update lockout state", async () => {
    await seedUser();
    await repository.incrementFailedLoginCount("user_auth_security");
    await repository.setAccountLockedUntil({
      userId: "user_auth_security",
      lockedUntil: "2026-06-28T01:00:00.000Z",
    });

    const locked =
      await repository.findLoginLockoutState("user_auth_security");
    assert.equal(locked.failed_login_count, 1);
    assert.equal(locked.locked_until, "2026-06-28T01:00:00.000Z");

    await repository.resetFailedLoginCount("user_auth_security");

    const reset = await repository.findLoginLockoutState("user_auth_security");
    assert.equal(reset.failed_login_count, 0);
    assert.equal(reset.locked_until, null);
  });

  test("setUserRiskLevel updates runtime risk classification", async () => {
    await seedUser();

    await repository.setUserRiskLevel({
      userId: "user_auth_security",
      riskLevel: "high",
    });

    const row = await db
      .prepare("SELECT risk_level FROM users WHERE id = ?")
      .get("user_auth_security");
    assert.equal(row.risk_level, "high");
  });
});
