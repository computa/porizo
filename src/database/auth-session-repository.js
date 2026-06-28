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
  };
}

function createAuthSessionRepository(db) {
  async function insertSession({
    id,
    userId,
    deviceName = null,
    ipAddress = null,
    userAgent = null,
  }) {
    return db
      .prepare(
        `INSERT INTO user_sessions (id, user_id, device_name, ip_address, user_agent, last_active_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(id, userId, deviceName, ipAddress, userAgent);
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
        "SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
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
        `SELECT id, user_id, device_name, ip_address, user_agent, last_active_at, created_at
         FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL
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
    revokeActiveSessionsForUser,
    revokeAllSessionsExcept,
  };
}

module.exports = { createAuthSessionRepository };
