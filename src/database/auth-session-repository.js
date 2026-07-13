"use strict";

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    deviceName: row.device_name,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    authMethod: row.auth_method,
    platform: row.platform,
    authenticatedAt: row.authenticated_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    lastRotatedAt: row.last_rotated_at,
  };
}

function createAuthSessionRepository(db) {
  async function insertSession({
    id,
    userId,
    deviceName = null,
    ipAddress = null,
    userAgent = null,
    authMethod = null,
    platform = null,
    authenticatedAt,
    idleExpiresAt,
    absoluteExpiresAt,
    lastRotatedAt,
    webSessionHash = null,
  }) {
    return db
      .prepare(
        `INSERT INTO user_sessions (
           id, user_id, device_name, ip_address, user_agent, last_active_at,
           auth_method, platform, authenticated_at, idle_expires_at,
           absolute_expires_at, last_rotated_at, web_session_hash
         ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, deviceName, ipAddress, userAgent, authMethod, platform,
        authenticatedAt, idleExpiresAt, absoluteExpiresAt, lastRotatedAt,
        webSessionHash);
  }

  async function findActiveUser(userId) {
    return db
      .prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL")
      .get(userId);
  }

  async function findUserAccountState(userId) {
    return db.prepare("SELECT id, deleted_at FROM users WHERE id = ?").get(userId);
  }

  async function findActiveSession({ sessionId, userId }) {
    return db
      .prepare(
        `SELECT id FROM user_sessions
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL
           AND (idle_expires_at IS NULL OR idle_expires_at > CURRENT_TIMESTAMP)
           AND (absolute_expires_at IS NULL OR absolute_expires_at > CURRENT_TIMESTAMP)`,
      )
      .get(sessionId, userId);
  }

  async function findSessionOwner(sessionId) {
    return db
      .prepare("SELECT user_id FROM user_sessions WHERE id = ?")
      .get(sessionId);
  }

  async function listActiveSessions(userId) {
    const rows = await db
      .prepare(
        `SELECT id, user_id, device_name, ip_address, user_agent, last_active_at, created_at,
                auth_method, platform, authenticated_at, idle_expires_at,
                absolute_expires_at, last_rotated_at
         FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL
           AND (idle_expires_at IS NULL OR idle_expires_at > CURRENT_TIMESTAMP)
           AND (absolute_expires_at IS NULL OR absolute_expires_at > CURRENT_TIMESTAMP)
         ORDER BY last_active_at DESC`,
      )
      .all(userId);
    return rows.map(mapSession);
  }

  async function revokeSession(sessionId) {
    return db
      .prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(sessionId);
  }

  async function findSessionLifetime(sessionId) {
    return db
      .prepare(
        `SELECT id, user_id, idle_expires_at, absolute_expires_at, authenticated_at
         FROM user_sessions WHERE id = ? AND revoked_at IS NULL`,
      )
      .get(sessionId);
  }

  async function findActiveWebSession(webSessionHash) {
    return db
      .prepare(
        `SELECT us.id, us.user_id, us.authenticated_at, us.absolute_expires_at
         FROM user_sessions us
         JOIN users u ON u.id = us.user_id
         WHERE us.web_session_hash = ? AND us.revoked_at IS NULL
           AND u.deleted_at IS NULL
           AND us.idle_expires_at > CURRENT_TIMESTAMP
           AND us.absolute_expires_at > CURRENT_TIMESTAMP`,
      )
      .get(webSessionHash);
  }

  async function touchWebSession({ sessionId, lastActiveAt, idleExpiresAt }) {
    return db
      .prepare(
        `UPDATE user_sessions
         SET last_active_at = ?, idle_expires_at = ?
         WHERE id = ? AND revoked_at IS NULL
           AND idle_expires_at > ? AND absolute_expires_at > ?`,
      )
      .run(lastActiveAt, idleExpiresAt, sessionId, lastActiveAt, lastActiveAt);
  }

  async function touchSession({ sessionId, lastActiveAt, idleExpiresAt, lastRotatedAt }) {
    return db
      .prepare(
        `UPDATE user_sessions
         SET last_active_at = ?, idle_expires_at = ?, last_rotated_at = ?
         WHERE id = ? AND revoked_at IS NULL AND absolute_expires_at > ?`,
      )
      .run(lastActiveAt, idleExpiresAt, lastRotatedAt, sessionId, lastActiveAt);
  }

  async function revokeActiveSessionsForUser(userId) {
    return db
      .prepare(
        "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
      )
      .run(userId);
  }

  async function revokeAllSessionsExcept(userId, currentSessionId) {
    return db
      .prepare(
        "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id != ?",
      )
      .run(userId, currentSessionId);
  }

  return {
    insertSession,
    findActiveUser,
    findUserAccountState,
    findActiveSession,
    findSessionOwner,
    listActiveSessions,
    revokeSession,
    findSessionLifetime,
    findActiveWebSession,
    touchWebSession,
    touchSession,
    revokeActiveSessionsForUser,
    revokeAllSessionsExcept,
  };
}

module.exports = { createAuthSessionRepository };
