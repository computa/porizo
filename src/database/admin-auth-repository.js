"use strict";

function createAdminAuthRepository(db) {
  async function findAdminByEmail(email) {
    return db.prepare("SELECT * FROM admin_users WHERE email = ?").get(email);
  }

  async function findAdminById(adminId) {
    return db.prepare("SELECT * FROM admin_users WHERE id = ?").get(adminId);
  }

  async function updateFailedLoginState({
    adminId,
    failedLoginCount,
    lockedUntil,
  }) {
    return db
      .prepare(
        "UPDATE admin_users SET failed_login_count = ?, locked_until = ? WHERE id = ?",
      )
      .run(failedLoginCount, lockedUntil, adminId);
  }

  async function markLoginSucceeded({ adminId, lastLoginAt }) {
    return db
      .prepare(
        "UPDATE admin_users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
      )
      .run(lastLoginAt, adminId);
  }

  async function insertSession({
    id,
    adminId,
    tokenHash,
    expiresAt,
    createdAt,
    ipAddress = null,
    userAgent = null,
  }) {
    return db
      .prepare(
        `INSERT INTO admin_sessions
         (id, admin_id, token_hash, expires_at, created_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, adminId, tokenHash, expiresAt, createdAt, ipAddress, userAgent);
  }

  async function findActiveSessionByTokenHash({ tokenHash, now }) {
    return db
      .prepare(
        `SELECT s.*, a.email, a.display_name, a.role
         FROM admin_sessions s
         JOIN admin_users a ON s.admin_id = a.id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, now);
  }

  async function deleteSessionByTokenHash(tokenHash) {
    return db
      .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
      .run(tokenHash);
  }

  async function insertAdmin({
    id,
    email,
    passwordHash,
    displayName,
    role,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO admin_users
         (id, email, password_hash, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, email, passwordHash, displayName, role, createdAt);
  }

  async function updatePassword({ adminId, passwordHash, updatedAt }) {
    return db
      .prepare(
        "UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?",
      )
      .run(passwordHash, updatedAt, adminId);
  }

  async function deleteSessionsForAdmin(adminId) {
    return db
      .prepare("DELETE FROM admin_sessions WHERE admin_id = ?")
      .run(adminId);
  }

  async function listAdmins() {
    return db
      .prepare(
        `SELECT id, email, display_name, role, created_at, last_login_at
         FROM admin_users
         ORDER BY created_at DESC`,
      )
      .all();
  }

  async function deleteExpiredSessions(now) {
    return db
      .prepare("DELETE FROM admin_sessions WHERE expires_at < ?")
      .run(now);
  }

  async function insertPasswordResetToken({
    id,
    adminId,
    tokenHash,
    expiresAt,
    ipAddress,
    createdAt,
  }) {
    return db
      .prepare(
        `INSERT INTO admin_password_reset_tokens
         (id, admin_id, token_hash, expires_at, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, adminId, tokenHash, expiresAt, ipAddress, createdAt);
  }

  async function findPasswordResetTokenByHash(tokenHash) {
    return db
      .prepare(
        `SELECT id, admin_id, expires_at, used_at
         FROM admin_password_reset_tokens
         WHERE token_hash = ?`,
      )
      .get(tokenHash);
  }

  async function markPasswordResetTokenUsed({ tokenId, usedAt }) {
    return db
      .prepare("UPDATE admin_password_reset_tokens SET used_at = ? WHERE id = ?")
      .run(usedAt, tokenId);
  }

  async function markUnusedPasswordResetTokensUsedForAdmin({
    adminId,
    usedAt,
  }) {
    return db
      .prepare(
        `UPDATE admin_password_reset_tokens
         SET used_at = ?
         WHERE admin_id = ? AND used_at IS NULL`,
      )
      .run(usedAt, adminId);
  }

  async function clearLockout({ adminId, updatedAt }) {
    return db
      .prepare(
        `UPDATE admin_users
         SET failed_login_count = 0, locked_until = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(updatedAt, adminId);
  }

  async function incrementRateLimitWindow({
    key,
    actionKey,
    windowStartMs,
    windowSeconds,
    limitCount,
  }) {
    await db
      .prepare(
        `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, action_type, window_start_ms)
         DO UPDATE SET count = rate_limits.count + 1`,
      )
      .run(key, actionKey, windowStartMs, windowSeconds, limitCount);

    const row = await db
      .prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
      )
      .get(key, actionKey, windowStartMs);
    return row ? Number(row.count || 0) : 0;
  }

  return {
    findAdminByEmail,
    findAdminById,
    updateFailedLoginState,
    markLoginSucceeded,
    insertSession,
    findActiveSessionByTokenHash,
    deleteSessionByTokenHash,
    insertAdmin,
    updatePassword,
    deleteSessionsForAdmin,
    listAdmins,
    deleteExpiredSessions,
    insertPasswordResetToken,
    findPasswordResetTokenByHash,
    markPasswordResetTokenUsed,
    markUnusedPasswordResetTokensUsedForAdmin,
    clearLockout,
    incrementRateLimitWindow,
  };
}

module.exports = {
  createAdminAuthRepository,
};
