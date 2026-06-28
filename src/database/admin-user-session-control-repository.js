"use strict";

function createAdminUserSessionControlRepository(db) {
  return {
    findReverifiableVoiceProfile(userId) {
      return db
        .prepare(
          `SELECT id, status
           FROM voice_profiles
           WHERE user_id = ?
             AND status IN ('completed', 'active')
             AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(userId);
    },

    markVoiceProfilePendingReverification(profileId) {
      return db
        .prepare(
          `UPDATE voice_profiles
           SET status = 'pending_reverification', last_verified_at = NULL
           WHERE id = ?
             AND status IN ('completed', 'active')
             AND deleted_at IS NULL`,
        )
        .run(profileId);
    },

    listActiveUserSessions(userId, limit) {
      return db
        .prepare(
          `SELECT id, device_name, ip_address, user_agent, created_at, last_active_at
           FROM user_sessions
           WHERE user_id = ? AND revoked_at IS NULL
           ORDER BY CASE WHEN last_active_at IS NULL THEN 1 ELSE 0 END,
                    last_active_at DESC,
                    created_at DESC,
                    id DESC
           LIMIT ?`,
        )
        .all(userId, limit);
    },

    revokeUserSession({ userId, sessionId, revokedAt }) {
      return db
        .prepare(
          `UPDATE user_sessions
           SET revoked_at = ?
           WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        )
        .run(revokedAt, sessionId, userId);
    },

    revokeAllUserSessions({ userId, revokedAt }) {
      return db
        .prepare(
          `UPDATE user_sessions
           SET revoked_at = ?
           WHERE user_id = ? AND revoked_at IS NULL`,
        )
        .run(revokedAt, userId);
    },
  };
}

module.exports = {
  createAdminUserSessionControlRepository,
};
