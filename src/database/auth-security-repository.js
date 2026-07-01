"use strict";

function createAuthSecurityRepository(db) {
  async function insertAuthEvent({
    id,
    userId = null,
    eventType,
    ipAddress = null,
    userAgent = null,
    metadataJson = null,
  }) {
    return db
      .prepare(
        `INSERT INTO auth_events (id, user_id, event_type, ip_address, user_agent, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, eventType, ipAddress, userAgent, metadataJson);
  }

  async function incrementFailedLoginCount(userId) {
    return db
      .prepare(
        "UPDATE users SET failed_login_count = COALESCE(failed_login_count, 0) + 1 WHERE id = ?",
      )
      .run(userId);
  }

  async function findLoginLockoutState(userId) {
    return db
      .prepare("SELECT failed_login_count, locked_until FROM users WHERE id = ?")
      .get(userId);
  }

  async function setAccountLockedUntil({ userId, lockedUntil }) {
    return db
      .prepare("UPDATE users SET locked_until = ? WHERE id = ?")
      .run(lockedUntil, userId);
  }

  async function resetFailedLoginCount(userId) {
    return db
      .prepare(
        "UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?",
      )
      .run(userId);
  }

  async function setUserRiskLevel({ userId, riskLevel }) {
    return db
      .prepare("UPDATE users SET risk_level = ? WHERE id = ?")
      .run(riskLevel, userId);
  }

  return {
    insertAuthEvent,
    incrementFailedLoginCount,
    findLoginLockoutState,
    setAccountLockedUntil,
    resetFailedLoginCount,
    setUserRiskLevel,
  };
}

module.exports = { createAuthSecurityRepository };
