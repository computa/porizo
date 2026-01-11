/**
 * Authentication Service
 *
 * Handles password hashing, JWT tokens, refresh tokens, password reset,
 * email verification, session management, and account lockout.
 */

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Configuration with secure defaults
const config = {
  bcryptCost: 12,
  accessTokenExpiry: "15m",
  refreshTokenExpiryDays: 30,
  passwordResetExpiryMinutes: 30,
  emailVerificationExpiryDays: 7,
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  jwtIssuer: "porizo",
};

// Database instance (initialized via initialize())
let db = null;

/**
 * Initialize the auth service with database instance
 */
function initialize(database) {
  db = database;
}

// ==================== PASSWORD HASHING ====================

/**
 * Hash a password using bcrypt with cost factor 12
 */
async function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptCost);
}

/**
 * Verify password against hash using constant-time comparison
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ==================== TOKEN UTILITIES ====================

/**
 * Generate a cryptographically secure random token (32 bytes = 256 bits)
 */
function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash a token using SHA-256 for storage
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate unique ID with prefix
 */
function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

// ==================== JWT ACCESS TOKENS ====================

/**
 * Generate JWT access token
 */
function generateAccessToken(userId, options = {}) {
  const expiresIn = options.expiresIn || config.accessTokenExpiry;

  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn,
    issuer: config.jwtIssuer,
  });
}

/**
 * Verify and decode JWT access token
 * Throws on invalid/expired token
 */
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: config.jwtIssuer,
  });
}

// ==================== REFRESH TOKENS ====================

/**
 * Create a new refresh token for user
 * Returns raw token (to send to client), plus metadata
 */
async function createRefreshToken(userId, options = {}) {
  const expiresIn = options.expiresIn ?? config.refreshTokenExpiryDays;

  // Create token family first
  const familyId = generateId("tf");
  db.prepare("INSERT INTO token_families (id, user_id) VALUES (?, ?)").run(familyId, userId);

  // Generate secure token
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const tokenId = generateId("rt");

  // Calculate expiration
  const expiresAt = new Date();
  if (expiresIn < 0) {
    expiresAt.setTime(expiresAt.getTime() + expiresIn * 24 * 60 * 60 * 1000); // Negative days for testing
  } else {
    expiresAt.setDate(expiresAt.getDate() + expiresIn);
  }

  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, generation, expires_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(tokenId, userId, tokenHash, familyId, expiresAt.toISOString());

  return {
    token: rawToken,
    tokenId,
    tokenFamily: familyId,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Verify refresh token
 * Returns user ID and token metadata if valid
 */
async function verifyRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);

  // Look up token by hash
  const token = db
    .prepare(
      `SELECT rt.*, tf.compromised_at as family_compromised
       FROM refresh_tokens rt
       JOIN token_families tf ON rt.token_family = tf.id
       WHERE rt.token_hash = ?`
    )
    .get(tokenHash);

  if (!token) {
    throw new Error("Token not found or invalid");
  }

  // Check if family is compromised (reuse attack detected)
  if (token.family_compromised) {
    throw new Error("Token family compromised");
  }

  // Check if revoked
  if (token.revoked_at) {
    throw new Error("Token has been revoked");
  }

  // Check expiration
  if (new Date(token.expires_at) < new Date()) {
    throw new Error("Token has expired");
  }

  return {
    userId: token.user_id,
    tokenId: token.id,
    tokenFamily: token.token_family,
    generation: token.generation,
  };
}

/**
 * Revoke a refresh token by ID
 */
async function revokeRefreshToken(tokenId) {
  db.prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?").run(tokenId);
}

/**
 * Rotate refresh token: revoke old, create new with same family
 * Detects token reuse attacks
 */
async function rotateRefreshToken(oldRawToken) {
  const oldTokenHash = hashToken(oldRawToken);

  // Get old token
  const oldToken = db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?").get(oldTokenHash);

  if (!oldToken) {
    throw new Error("Token not found");
  }

  // Check if already revoked (possible reuse attack!)
  if (oldToken.revoked_at) {
    // Mark entire family as compromised
    db.prepare("UPDATE token_families SET compromised_at = datetime('now') WHERE id = ?").run(oldToken.token_family);

    // Revoke all tokens in family
    db.prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_family = ?").run(
      oldToken.token_family
    );

    throw new Error("Token reuse detected - family compromised");
  }

  // Check if family already compromised
  const family = db.prepare("SELECT * FROM token_families WHERE id = ?").get(oldToken.token_family);
  if (family.compromised_at) {
    throw new Error("Token family compromised");
  }

  // Revoke old token
  db.prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?").run(oldToken.id);

  // Generate new token in same family
  const newRawToken = generateSecureToken();
  const newTokenHash = hashToken(newRawToken);
  const newTokenId = generateId("rt");
  const newGeneration = oldToken.generation + 1;

  // Calculate new expiration (30 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.refreshTokenExpiryDays);

  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, generation, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newTokenId, oldToken.user_id, newTokenHash, oldToken.token_family, newGeneration, expiresAt.toISOString());

  return {
    token: newRawToken,
    tokenId: newTokenId,
    tokenFamily: oldToken.token_family,
    generation: newGeneration,
    expiresAt: expiresAt.toISOString(),
  };
}

// ==================== PASSWORD RESET TOKENS ====================

/**
 * Create password reset token
 */
async function createPasswordResetToken(userId, options = {}) {
  const expiresIn = options.expiresIn ?? config.passwordResetExpiryMinutes;

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const tokenId = generateId("prt");

  const expiresAt = new Date();
  if (expiresIn < 0) {
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresIn);
  } else {
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresIn);
  }

  db.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(tokenId, userId, tokenHash, expiresAt.toISOString());

  return {
    token: rawToken,
    tokenId,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Verify password reset token
 */
async function verifyPasswordResetToken(rawToken) {
  const tokenHash = hashToken(rawToken);

  const token = db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ?").get(tokenHash);

  if (!token) {
    throw new Error("Token not found or invalid");
  }

  if (token.used_at) {
    throw new Error("Token has already been used");
  }

  if (new Date(token.expires_at) < new Date()) {
    throw new Error("Token has expired");
  }

  return {
    userId: token.user_id,
    tokenId: token.id,
  };
}

/**
 * Mark password reset token as used
 */
async function markPasswordResetTokenUsed(tokenId) {
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(tokenId);
}

/**
 * Invalidate all password reset tokens for user
 */
async function invalidateAllPasswordResetTokens(userId) {
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(
    userId
  );
}

// ==================== EMAIL VERIFICATION TOKENS ====================

/**
 * Create email verification token
 */
async function createEmailVerificationToken(userId) {
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const tokenId = generateId("evt");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.emailVerificationExpiryDays);

  db.prepare(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(tokenId, userId, tokenHash, expiresAt.toISOString());

  return {
    token: rawToken,
    tokenId,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Verify email verification token
 */
async function verifyEmailVerificationToken(rawToken) {
  const tokenHash = hashToken(rawToken);

  const token = db.prepare("SELECT * FROM email_verification_tokens WHERE token_hash = ?").get(tokenHash);

  if (!token) {
    throw new Error("Token not found or invalid");
  }

  if (token.used_at) {
    throw new Error("Token has already been used");
  }

  if (new Date(token.expires_at) < new Date()) {
    throw new Error("Token has expired");
  }

  return {
    userId: token.user_id,
    tokenId: token.id,
  };
}

/**
 * Mark email verification token as used
 */
async function markEmailVerificationTokenUsed(tokenId) {
  db.prepare("UPDATE email_verification_tokens SET used_at = datetime('now') WHERE id = ?").run(tokenId);
}

// ==================== SESSION MANAGEMENT ====================

/**
 * Create a session for user
 */
async function createSession(userId, sessionData = {}) {
  const sessionId = generateId("sess");

  db.prepare(
    `INSERT INTO user_sessions (id, user_id, device_name, ip_address, user_agent, last_active_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(sessionId, userId, sessionData.deviceName || null, sessionData.ipAddress || null, sessionData.userAgent || null);

  return {
    id: sessionId,
    userId,
    deviceName: sessionData.deviceName,
    ipAddress: sessionData.ipAddress,
    userAgent: sessionData.userAgent,
  };
}

/**
 * List active sessions for user (not revoked)
 */
async function listSessions(userId) {
  return db
    .prepare(
      `SELECT id, user_id, device_name, ip_address, user_agent, last_active_at, created_at
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY last_active_at DESC`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      deviceName: row.device_name,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    }));
}

/**
 * Revoke a session
 */
async function revokeSession(sessionId) {
  db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?").run(sessionId);
}

/**
 * Revoke all sessions except the current one
 */
async function revokeAllSessionsExcept(userId, currentSessionId) {
  db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ?").run(
    userId,
    currentSessionId
  );
}

// ==================== AUTH EVENTS (AUDIT) ====================

/**
 * Log an authentication event
 */
async function logAuthEvent({ userId, eventType, ipAddress, userAgent, metadata }) {
  const eventId = generateId("evt");

  db.prepare(
    `INSERT INTO auth_events (id, user_id, event_type, ip_address, user_agent, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(eventId, userId || null, eventType, ipAddress || null, userAgent || null, metadata ? JSON.stringify(metadata) : null);

  return eventId;
}

// ==================== ACCOUNT LOCKOUT ====================

/**
 * Increment failed login count for user
 * Locks account if threshold reached
 */
async function incrementFailedLoginCount(userId) {
  const user = db.prepare("SELECT failed_login_count FROM users WHERE id = ?").get(userId);
  const newCount = (user?.failed_login_count || 0) + 1;

  if (newCount >= config.maxFailedLoginAttempts) {
    // Lock account
    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + config.lockoutDurationMinutes);

    db.prepare("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?").run(
      newCount,
      lockedUntil.toISOString(),
      userId
    );
  } else {
    db.prepare("UPDATE users SET failed_login_count = ? WHERE id = ?").run(newCount, userId);
  }
}

/**
 * Check if account is locked
 */
async function isAccountLocked(userId) {
  const user = db.prepare("SELECT locked_until FROM users WHERE id = ?").get(userId);

  if (!user?.locked_until) {
    return false;
  }

  return new Date(user.locked_until) > new Date();
}

/**
 * Reset failed login count (on successful login)
 */
async function resetFailedLoginCount(userId) {
  db.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?").run(userId);
}

// ==================== EXPORTS ====================

module.exports = {
  initialize,

  // Password
  hashPassword,
  verifyPassword,

  // Token utilities
  generateSecureToken,
  hashToken,

  // JWT
  generateAccessToken,
  verifyAccessToken,

  // Refresh tokens
  createRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,

  // Password reset
  createPasswordResetToken,
  verifyPasswordResetToken,
  markPasswordResetTokenUsed,
  invalidateAllPasswordResetTokens,

  // Email verification
  createEmailVerificationToken,
  verifyEmailVerificationToken,
  markEmailVerificationTokenUsed,

  // Sessions
  createSession,
  listSessions,
  revokeSession,
  revokeAllSessionsExcept,

  // Auth events
  logAuthEvent,

  // Lockout
  incrementFailedLoginCount,
  isAccountLocked,
  resetFailedLoginCount,
};
