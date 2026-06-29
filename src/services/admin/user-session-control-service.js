"use strict";

function createAdminUserSessionControlService({
  adminUserSessionControlRepository,
  audit,
  now = () => new Date(),
}) {
  if (!adminUserSessionControlRepository) {
    throw new Error("adminUserSessionControlRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowIso() {
    const value = now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  async function forceVoiceReverify(userId, adminId, reason) {
    const profile =
      await adminUserSessionControlRepository.findReverifiableVoiceProfile(
        userId,
      );

    if (!profile) {
      return { success: false, error: "No active voice profile found" };
    }

    const result =
      await adminUserSessionControlRepository.markVoiceProfilePendingReverification(
        profile.id,
      );
    if (result.changes === 0) {
      return { success: false, error: "No active voice profile found" };
    }

    await audit(adminId, "admin_force_reverify", "voice_profile", profile.id, {
      targetUserId: userId,
      previousStatus: profile.status,
      reason,
    });

    return { success: true, voiceProfileId: profile.id };
  }

  async function getUserSessions(userId, limit = 20) {
    return await adminUserSessionControlRepository.listActiveUserSessions(
      userId,
      limit,
    );
  }

  async function revokeUserSession(userId, sessionId, adminId, reason) {
    const result = await adminUserSessionControlRepository.revokeUserSession({
      userId,
      sessionId,
      revokedAt: nowIso(),
    });

    if (result.changes === 0) {
      return { success: false, error: "Session not found or already revoked" };
    }

    await audit(adminId, "admin_revoke_session", "session", sessionId, {
      targetUserId: userId,
      reason,
    });
    return { success: true };
  }

  async function revokeAllUserSessions(userId, adminId, reason) {
    const result =
      await adminUserSessionControlRepository.revokeAllUserSessions({
        userId,
        revokedAt: nowIso(),
      });

    await audit(adminId, "admin_revoke_all_sessions", "user", userId, {
      sessionsRevoked: result.changes,
      reason,
    });
    return { success: true, sessionsRevoked: result.changes };
  }

  return {
    forceVoiceReverify,
    getUserSessions,
    revokeUserSession,
    revokeAllUserSessions,
  };
}

module.exports = {
  createAdminUserSessionControlService,
};
