const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminUserSessionControlService,
} = require("../src/services/admin/user-session-control-service");

const FIXED_NOW = "2026-06-29T12:00:00.000Z";

function createUserSessionControlFixture({ repository = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    findReverifiableVoiceProfile: async (userId) => {
      calls.push({ name: "findReverifiableVoiceProfile", userId });
      return { id: "voice_active", status: "active" };
    },
    markVoiceProfilePendingReverification: async (profileId) => {
      calls.push({ name: "markVoiceProfilePendingReverification", profileId });
      return { changes: 1 };
    },
    listActiveUserSessions: async (userId, limit) => {
      calls.push({ name: "listActiveUserSessions", userId, limit });
      return [{ id: "session_active" }];
    },
    revokeUserSession: async (payload) => {
      calls.push({ name: "revokeUserSession", payload });
      return { changes: 1 };
    },
    revokeAllUserSessions: async (payload) => {
      calls.push({ name: "revokeAllUserSessions", payload });
      return { changes: 2 };
    },
  };

  const service = createAdminUserSessionControlService({
    adminUserSessionControlRepository: { ...defaults, ...repository },
    audit: async (...args) => audits.push(args),
    now: () => new Date(FIXED_NOW),
  });

  return { audits, calls, service };
}

describe("AdminUserSessionControlService", () => {
  test("forces voice reverify and audits previous profile status", async () => {
    const { audits, calls, service } = createUserSessionControlFixture();

    assert.deepEqual(
      await service.forceVoiceReverify(
        "user_voice",
        "admin_ops",
        "consent review",
      ),
      { success: true, voiceProfileId: "voice_active" },
    );
    assert.deepEqual(calls, [
      { name: "findReverifiableVoiceProfile", userId: "user_voice" },
      {
        name: "markVoiceProfilePendingReverification",
        profileId: "voice_active",
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_force_reverify",
        "voice_profile",
        "voice_active",
        {
          targetUserId: "user_voice",
          previousStatus: "active",
          reason: "consent review",
        },
      ],
    ]);
  });

  test("does not audit failed voice reverify attempts", async () => {
    const missingProfile = createUserSessionControlFixture({
      repository: { findReverifiableVoiceProfile: async () => null },
    });

    assert.deepEqual(
      await missingProfile.service.forceVoiceReverify(
        "user_missing",
        "admin_ops",
        "consent review",
      ),
      { success: false, error: "No active voice profile found" },
    );
    assert.deepEqual(missingProfile.audits, []);

    const race = createUserSessionControlFixture({
      repository: {
        markVoiceProfilePendingReverification: async () => ({ changes: 0 }),
      },
    });

    assert.deepEqual(
      await race.service.forceVoiceReverify(
        "user_race",
        "admin_ops",
        "consent review",
      ),
      { success: false, error: "No active voice profile found" },
    );
    assert.deepEqual(race.audits, []);
  });

  test("delegates active session list lookup with the provided limit", async () => {
    const { calls, service } = createUserSessionControlFixture();

    assert.deepEqual(await service.getUserSessions("user_sessions", 7), [
      { id: "session_active" },
    ]);
    assert.deepEqual(calls, [
      {
        name: "listActiveUserSessions",
        userId: "user_sessions",
        limit: 7,
      },
    ]);
  });

  test("revokes one user session and audits only a successful update", async () => {
    const { audits, calls, service } = createUserSessionControlFixture();

    assert.deepEqual(
      await service.revokeUserSession(
        "user_sessions",
        "session_active",
        "admin_ops",
        "device lost",
      ),
      { success: true },
    );
    assert.deepEqual(calls, [
      {
        name: "revokeUserSession",
        payload: {
          userId: "user_sessions",
          sessionId: "session_active",
          revokedAt: FIXED_NOW,
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_revoke_session",
        "session",
        "session_active",
        { targetUserId: "user_sessions", reason: "device lost" },
      ],
    ]);
  });

  test("does not audit missing or already-revoked single sessions", async () => {
    const { audits, service } = createUserSessionControlFixture({
      repository: { revokeUserSession: async () => ({ changes: 0 }) },
    });

    assert.deepEqual(
      await service.revokeUserSession(
        "user_sessions",
        "session_missing",
        "admin_ops",
        "device lost",
      ),
      { success: false, error: "Session not found or already revoked" },
    );
    assert.deepEqual(audits, []);
  });

  test("revokes all sessions and audits the affected count", async () => {
    const { audits, calls, service } = createUserSessionControlFixture();

    assert.deepEqual(
      await service.revokeAllUserSessions(
        "user_sessions",
        "admin_ops",
        "account compromise",
      ),
      { success: true, sessionsRevoked: 2 },
    );
    assert.deepEqual(calls, [
      {
        name: "revokeAllUserSessions",
        payload: {
          userId: "user_sessions",
          revokedAt: FIXED_NOW,
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_revoke_all_sessions",
        "user",
        "user_sessions",
        { sessionsRevoked: 2, reason: "account compromise" },
      ],
    ]);
  });
});
