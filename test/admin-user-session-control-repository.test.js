require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminUserSessionControlRepository,
} = require("../src/database/admin-user-session-control-repository");

const NOW = "2026-06-27T10:00:00.000Z";

async function seedUser(db, id) {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, risk_level)
       VALUES (?, ?, ?, ?, 'low')`,
    )
    .run(id, `${id}@example.com`, id, NOW);
}

async function seedSession(db, fields) {
  await db
    .prepare(
      `INSERT INTO user_sessions (
        id, user_id, device_name, ip_address, user_agent,
        last_active_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId,
      fields.deviceName ?? null,
      fields.ipAddress ?? null,
      fields.userAgent ?? null,
      fields.lastActiveAt === undefined ? NOW : fields.lastActiveAt,
      fields.revokedAt ?? null,
      fields.createdAt ?? NOW,
    );
}

async function seedVoiceProfile(db, fields) {
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, last_verified_at, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId,
      fields.status,
      fields.lastVerifiedAt ?? NOW,
      fields.createdAt ?? NOW,
      fields.deletedAt ?? null,
    );
}

describe("admin user session control repository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminUserSessionControlRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("finds and marks only active or completed voice profiles", async () => {
    const userId = "repo_voice_user";
    await seedUser(db, userId);
    await seedVoiceProfile(db, {
      id: "voice_completed_old",
      userId,
      status: "completed",
      lastVerifiedAt: "2026-06-25T10:00:00.000Z",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    await seedVoiceProfile(db, {
      id: "voice_active",
      userId,
      status: "active",
      lastVerifiedAt: "2026-06-26T10:00:00.000Z",
      createdAt: "2026-06-26T10:00:00.000Z",
    });
    await seedVoiceProfile(db, {
      id: "voice_deleted",
      userId,
      status: "completed",
      deletedAt: "2026-06-25T10:00:00.000Z",
    });

    const profile = await repository.findReverifiableVoiceProfile(userId);
    assert.deepEqual(profile, { id: "voice_active", status: "active" });

    const result = await repository.markVoiceProfilePendingReverification(
      profile.id,
    );
    assert.equal(result.changes, 1);

    const row = await db
      .prepare("SELECT status, last_verified_at FROM voice_profiles WHERE id = ?")
      .get("voice_active");
    assert.equal(row.status, "pending_reverification");
    assert.equal(row.last_verified_at, null);
  });

  test("voice reverification update no-ops when profile eligibility becomes stale", async () => {
    const userId = "repo_voice_stale_user";
    await seedUser(db, userId);
    await seedVoiceProfile(db, {
      id: "voice_stale",
      userId,
      status: "active",
    });

    const profile = await repository.findReverifiableVoiceProfile(userId);
    assert.deepEqual(profile, { id: "voice_stale", status: "active" });

    await db
      .prepare("UPDATE voice_profiles SET status = 'pending' WHERE id = ?")
      .run(profile.id);

    const result = await repository.markVoiceProfilePendingReverification(
      profile.id,
    );
    assert.equal(result.changes, 0);

    const row = await db
      .prepare("SELECT status, last_verified_at FROM voice_profiles WHERE id = ?")
      .get(profile.id);
    assert.equal(row.status, "pending");
    assert.equal(row.last_verified_at, NOW);
  });

  test("lists active user sessions ordered by last activity", async () => {
    const userId = "repo_session_list_user";
    await seedUser(db, userId);
    await seedSession(db, {
      id: "session_old",
      userId,
      deviceName: "Old iPhone",
      lastActiveAt: "2026-06-20T10:00:00.000Z",
    });
    await seedSession(db, {
      id: "session_new",
      userId,
      deviceName: "New iPhone",
      lastActiveAt: "2026-06-27T09:00:00.000Z",
    });
    await seedSession(db, {
      id: "session_unknown_activity",
      userId,
      deviceName: "Unknown activity",
      lastActiveAt: null,
    });
    await seedSession(db, {
      id: "session_revoked",
      userId,
      lastActiveAt: "2026-06-27T10:00:00.000Z",
      revokedAt: "2026-06-27T10:30:00.000Z",
    });

    const rows = await repository.listActiveUserSessions(userId, 20);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["session_new", "session_old", "session_unknown_activity"],
    );
    assert.equal(rows[0].device_name, "New iPhone");
    assert.equal(rows[0].created_at, NOW);
  });

  test("revokes one or all active sessions without touching existing revocations", async () => {
    const userId = "repo_session_revoke_user";
    await seedUser(db, userId);
    await seedSession(db, { id: "session_one", userId });
    await seedSession(db, { id: "session_two", userId });
    await seedSession(db, {
      id: "session_old_revoked",
      userId,
      revokedAt: "2026-06-25T10:00:00.000Z",
    });

    let result = await repository.revokeUserSession({
      userId,
      sessionId: "session_one",
      revokedAt: "2026-06-27T11:00:00.000Z",
    });
    assert.equal(result.changes, 1);

    result = await repository.revokeUserSession({
      userId,
      sessionId: "session_one",
      revokedAt: "2026-06-27T11:05:00.000Z",
    });
    assert.equal(result.changes, 0);

    result = await repository.revokeAllUserSessions({
      userId,
      revokedAt: "2026-06-27T12:00:00.000Z",
    });
    assert.equal(result.changes, 1);

    const rows = await db
      .prepare("SELECT id, revoked_at FROM user_sessions WHERE user_id = ?")
      .all(userId);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.revoked_at]));
    assert.equal(byId.session_one, "2026-06-27T11:00:00.000Z");
    assert.equal(byId.session_two, "2026-06-27T12:00:00.000Z");
    assert.equal(byId.session_old_revoked, "2026-06-25T10:00:00.000Z");
  });
});
