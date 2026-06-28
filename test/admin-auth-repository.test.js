process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminAuthRepository,
} = require("../src/database/admin-auth-repository");

let db;
let repository;

describe("AdminAuthRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminAuthRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("finds admins and updates login state", async () => {
    await repository.insertAdmin({
      id: "adm_repo_login",
      email: "repo-login@example.com",
      passwordHash: "hash",
      displayName: "Repo Login",
      role: "admin",
      createdAt: "2026-06-28T00:00:00.000Z",
    });

    const admin = await repository.findAdminByEmail("repo-login@example.com");
    assert.equal(admin.id, "adm_repo_login");

    await repository.updateFailedLoginState({
      adminId: admin.id,
      failedLoginCount: 3,
      lockedUntil: "2026-06-28T01:00:00.000Z",
    });
    assert.equal((await repository.findAdminById(admin.id)).failed_login_count, 3);

    await repository.markLoginSucceeded({
      adminId: admin.id,
      lastLoginAt: "2026-06-28T02:00:00.000Z",
    });

    const resetAdmin = await repository.findAdminById(admin.id);
    assert.equal(resetAdmin.failed_login_count, 0);
    assert.equal(resetAdmin.locked_until, null);
    assert.equal(resetAdmin.last_login_at, "2026-06-28T02:00:00.000Z");
  });

  test("stores, validates, deletes, and expires sessions", async () => {
    await repository.insertAdmin({
      id: "adm_repo_session",
      email: "repo-session@example.com",
      passwordHash: "hash",
      displayName: "Repo Session",
      role: "superadmin",
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    await repository.insertSession({
      id: "sess_active",
      adminId: "adm_repo_session",
      tokenHash: "active_hash",
      expiresAt: "2026-06-28T02:00:00.000Z",
      createdAt: "2026-06-28T00:00:00.000Z",
      ipAddress: "127.0.0.1",
      userAgent: "test",
    });
    await repository.insertSession({
      id: "sess_expired",
      adminId: "adm_repo_session",
      tokenHash: "expired_hash",
      expiresAt: "2026-06-27T23:00:00.000Z",
      createdAt: "2026-06-27T22:00:00.000Z",
    });

    const activeSession = await repository.findActiveSessionByTokenHash({
      tokenHash: "active_hash",
      now: "2026-06-28T01:00:00.000Z",
    });
    assert.equal(activeSession.admin_id, "adm_repo_session");
    assert.equal(activeSession.email, "repo-session@example.com");
    assert.equal(activeSession.role, "superadmin");

    const expiredSession = await repository.findActiveSessionByTokenHash({
      tokenHash: "expired_hash",
      now: "2026-06-28T01:00:00.000Z",
    });
    assert.equal(expiredSession, undefined);

    assert.equal(
      (await repository.deleteSessionByTokenHash("active_hash")).changes,
      1,
    );
    assert.equal(
      await repository.findActiveSessionByTokenHash({
        tokenHash: "active_hash",
        now: "2026-06-28T01:00:00.000Z",
      }),
      undefined,
    );
    assert.equal(
      (await repository.deleteExpiredSessions("2026-06-28T01:00:00.000Z"))
        .changes,
      1,
    );
  });

  test("persists password reset token lifecycle", async () => {
    await repository.insertAdmin({
      id: "adm_repo_reset",
      email: "repo-reset@example.com",
      passwordHash: "hash",
      displayName: "Repo Reset",
      role: "admin",
      createdAt: "2026-06-28T00:00:00.000Z",
    });

    await repository.insertPasswordResetToken({
      id: "apt_repo_reset",
      adminId: "adm_repo_reset",
      tokenHash: "reset_hash",
      expiresAt: "2026-06-28T01:00:00.000Z",
      ipAddress: "127.0.0.1",
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    assert.equal(
      (await repository.findPasswordResetTokenByHash("reset_hash")).admin_id,
      "adm_repo_reset",
    );

    await repository.markPasswordResetTokenUsed({
      tokenId: "apt_repo_reset",
      usedAt: "2026-06-28T00:10:00.000Z",
    });
    assert.equal(
      (await repository.findPasswordResetTokenByHash("reset_hash")).used_at,
      "2026-06-28T00:10:00.000Z",
    );

    await repository.insertPasswordResetToken({
      id: "apt_repo_reset_2",
      adminId: "adm_repo_reset",
      tokenHash: "reset_hash_2",
      expiresAt: "2026-06-28T01:00:00.000Z",
      ipAddress: null,
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    await repository.markUnusedPasswordResetTokensUsedForAdmin({
      adminId: "adm_repo_reset",
      usedAt: "2026-06-28T00:20:00.000Z",
    });

    assert.equal(
      (await repository.findPasswordResetTokenByHash("reset_hash_2")).used_at,
      "2026-06-28T00:20:00.000Z",
    );
  });
});
