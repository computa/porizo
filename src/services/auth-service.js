/**
 * Authentication Service
 *
 * Handles password hashing, JWT tokens, refresh tokens, password reset,
 * email verification, session management, and account lockout.
 */

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { authLogger } = require("../utils/logger");

// Validate required environment variables
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // In test environment, allow a default for convenience
    if (process.env.NODE_ENV === "test") {
      return "test-jwt-secret-do-not-use-in-production";
    }
    throw new Error(
      "CRITICAL: JWT_SECRET environment variable is not set. " +
        "This is required for secure token signing. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "CRITICAL: JWT_SECRET must be at least 32 characters long for security."
    );
  }
  return secret;
}

// Configuration with secure defaults
// Token lifetimes optimized for mobile apps (Spotify-style persistent login)
// - 60 minute access tokens: enough for typical sessions, less refresh overhead
// - 90 day refresh tokens: keeps active users logged in long-term
const config = {
  bcryptCost: 12,
  accessTokenExpiry: "60m",
  refreshTokenExpiryDays: 90,
  passwordResetExpiryMinutes: 30,
  emailVerificationExpiryDays: 7,
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  jwtSecret: getJwtSecret(),
  jwtIssuer: "porizo",
};

function getJwtFingerprint() {
  return {
    issuer: config.jwtIssuer,
    accessTokenExpiry: config.accessTokenExpiry,
    refreshTokenExpiryDays: config.refreshTokenExpiryDays,
    secretHash: crypto.createHash("sha256").update(config.jwtSecret).digest("hex").slice(0, 12),
  };
}

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
function verifyAccessToken(token, options = {}) {
  const defaultClockToleranceSec = process.env.NODE_ENV === "test" ? 0 : 30;
  return jwt.verify(token, config.jwtSecret, {
    issuer: config.jwtIssuer,
    // Allow clock drift in non-test env to avoid false expirations from slight skew.
    clockTolerance: options.clockToleranceSec ?? defaultClockToleranceSec,
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
  await db.prepare("INSERT INTO token_families (id, user_id) VALUES (?, ?)").run(familyId, userId);

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

  await db.prepare(
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
  const token = await db
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
  await db.prepare("UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").run(tokenId);
}

/**
 * Revoke all refresh tokens for a user (batch operation)
 * Used on logout, password change, and security events
 *
 * @param {string} userId - User ID
 * @returns {number} Number of tokens revoked
 */
async function revokeAllRefreshTokensForUser(userId) {
  const result = await db.prepare(
    "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL"
  ).run(userId);
  authLogger.info({ userId, tokensRevoked: result.changes }, "All refresh tokens revoked (logout)");
  return result.changes;
}

/**
 * Mark all token families for a user as compromised
 * Used on password change to invalidate all existing sessions
 *
 * @param {string} userId - User ID
 * @returns {number} Number of families marked compromised
 */
async function compromiseAllTokenFamiliesForUser(userId) {
  const result = await db.prepare(
    "UPDATE token_families SET compromised_at = CURRENT_TIMESTAMP WHERE user_id = ? AND compromised_at IS NULL"
  ).run(userId);
  return result.changes;
}

/**
 * Rotate refresh token: revoke old, create new with same family
 * Detects token reuse attacks
 *
 * IMPORTANT: This operation is atomic to prevent TOCTOU race conditions.
 * All checks and writes happen within a single transaction.
 */
async function rotateRefreshToken(oldRawToken) {
  const oldTokenHash = hashToken(oldRawToken);

  // Pre-generate new token values (crypto operations outside transaction)
  const newRawToken = generateSecureToken();
  const newTokenHash = hashToken(newRawToken);
  const newTokenId = generateId("rt");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.refreshTokenExpiryDays);

  const parseDbTimestamp = (value) => {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
      // SQLite CURRENT_TIMESTAMP is UTC without timezone suffix.
      return new Date(value.replace(" ", "T") + "Z");
    }
    return new Date(value);
  };

  // Atomic transaction: check + revoke + create all happen together
  // This prevents TOCTOU race conditions where concurrent requests
  // could both pass the revocation check.
  let result;
  try {
    result = await db.transaction(async () => {
    // Get old token with fresh read inside transaction
    const oldToken = await db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?").get(oldTokenHash);

    if (!oldToken) {
      const err = new Error("Token not found");
      err.code = "TOKEN_NOT_FOUND";
      throw err;
    }

    // Check if already revoked (possible reuse attack!)
    if (oldToken.revoked_at) {
      const revokedAt = parseDbTimestamp(oldToken.revoked_at);
      const gracePeriodMs = 30 * 1000; // 30 second grace period for app kill scenarios
      const timeSinceRevocation = revokedAt ? Date.now() - revokedAt.getTime() : Number.POSITIVE_INFINITY;

      // If revoked within grace period, this is likely an app that was killed during refresh
      // Find and check if a replacement token was already issued
      if (timeSinceRevocation < gracePeriodMs) {
        const replacementToken = await db.prepare(
          `SELECT id FROM refresh_tokens
           WHERE token_family = ? AND generation = ? AND revoked_at IS NULL`
        ).get(oldToken.token_family, oldToken.generation + 1);

        if (replacementToken) {
          // A new token was already issued - client needs to re-authenticate
          // but we DON'T mark the family as compromised (not a real attack)
          authLogger.info(
            { timeSinceRevocation, hasReplacement: true },
            "Token reuse within grace period - replacement exists, requesting re-auth"
          );
          const err = new Error("Token already rotated - please re-authenticate");
          err.code = "TOKEN_ALREADY_ROTATED";
          throw err;
        }

        // Within grace period but no replacement token - likely a failed/interrupted refresh
        // Allow this token to be reused (un-revoke it and proceed normally)
        // This handles edge cases like server crash during token rotation
        authLogger.info(
          { timeSinceRevocation, hasReplacement: false, tokenId: oldToken.id },
          "Token reuse within grace period - no replacement, allowing reuse"
        );
        await db.prepare("UPDATE refresh_tokens SET revoked_at = NULL WHERE id = ?").run(oldToken.id);
        // Continue with normal rotation flow - the token is now un-revoked
        // Fall through to the rest of the function
      } else {
        // Outside grace period = potential attack, compromise the family
        authLogger.warn(
          { timeSinceRevocation, tokenFamily: oldToken.token_family },
          "Token reuse detected outside grace period - compromising family"
        );

        // Mark entire family as compromised
        await db.prepare("UPDATE token_families SET compromised_at = CURRENT_TIMESTAMP WHERE id = ?").run(oldToken.token_family);

        // Revoke all tokens in family
        await db.prepare("UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_family = ?").run(
          oldToken.token_family
        );

        return {
          reuseDetected: true,
          tokenFamily: oldToken.token_family,
        };
      }
    }

    // Check if family already compromised
    const family = await db.prepare("SELECT * FROM token_families WHERE id = ?").get(oldToken.token_family);
    if (family.compromised_at) {
      const err = new Error("Token family compromised");
      err.code = "TOKEN_FAMILY_COMPROMISED";
      throw err;
    }

    // Revoke old token using optimistic locking to prevent TOCTOU race
    // The conditional WHERE revoked_at IS NULL ensures only ONE concurrent
    // refresh request can succeed - others will get changes=0
    const revokeResult = await db.prepare(
      "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL"
    ).run(oldToken.id);

    // If no rows affected, another concurrent request already revoked this token
    if (revokeResult.changes === 0) {
      // Re-check if a replacement token was created (within grace period scenario)
      const replacementToken = await db.prepare(
        `SELECT id FROM refresh_tokens
         WHERE token_family = ? AND generation = ? AND revoked_at IS NULL`
      ).get(oldToken.token_family, oldToken.generation + 1);

      if (replacementToken) {
        authLogger.info(
          { tokenId: oldToken.id, hasReplacement: true },
          "Concurrent token rotation detected - replacement exists"
        );
        const err = new Error("Token already rotated - please re-authenticate");
        err.code = "TOKEN_ALREADY_ROTATED";
        throw err;
      }

      // No replacement but couldn't revoke - unexpected state, fail safely
      authLogger.warn(
        { tokenId: oldToken.id },
        "Concurrent token rotation detected - no replacement found, failing safely"
      );
      const err = new Error("Token rotation conflict - please retry");
      err.code = "TOKEN_ROTATION_CONFLICT";
      throw err;
    }

    // Create new token in same family
    const newGeneration = oldToken.generation + 1;
    await db.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, generation, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newTokenId, oldToken.user_id, newTokenHash, oldToken.token_family, newGeneration, expiresAt.toISOString());

    return {
      userId: oldToken.user_id,
      tokenFamily: oldToken.token_family,
      generation: newGeneration,
    };
    });
  } catch (err) {
    if (
      err?.code === "ERR_SQLITE_ERROR" &&
      /locked|busy|cannot start a transaction within a transaction/i.test(String(err.message || ""))
    ) {
      const conflictError = new Error("Token rotation conflict - please retry");
      conflictError.code = "TOKEN_ROTATION_CONFLICT";
      throw conflictError;
    }
    throw err;
  }

  if (result?.reuseDetected) {
    const err = new Error("Token reuse detected - family compromised");
    err.code = "TOKEN_REUSE_DETECTED";
    throw err;
  }

  authLogger.info(
    { userId: result.userId, tokenFamily: result.tokenFamily, generation: result.generation },
    "Token rotated successfully"
  );

  return {
    userId: result.userId,
    token: newRawToken,
    tokenId: newTokenId,
    tokenFamily: result.tokenFamily,
    generation: result.generation,
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
  expiresAt.setMinutes(expiresAt.getMinutes() + expiresIn);

  await db.prepare(
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
 * Verify a one-time token (password reset or email verification)
 * @param {string} rawToken - The raw token to verify
 * @param {string} tableName - The table to query
 * @returns {Promise<{userId: string, tokenId: string}>}
 */
async function verifyOneTimeToken(rawToken, tableName) {
  const ALLOWED_TABLES = ["password_reset_tokens", "email_verification_tokens"];
  if (!ALLOWED_TABLES.includes(tableName)) {
    throw new Error(`Invalid token table: ${tableName}`);
  }

  const tokenHash = hashToken(rawToken);

  // Wrap in transaction so the SELECT and subsequent UPDATE (mark used) are atomic.
  // This prevents double-use from concurrent requests racing on the same token.
  return await db.transaction(async () => {
    const token = await db.prepare(`SELECT * FROM ${tableName} WHERE token_hash = ?`).get(tokenHash);

    if (!token) {
      throw new Error("Token not found or invalid");
    }

    if (token.used_at) {
      throw new Error("Token has already been used");
    }

    if (new Date(token.expires_at) < new Date()) {
      throw new Error("Token has expired");
    }

    // Mark as used immediately inside the transaction to prevent concurrent reuse
    await db.prepare(`UPDATE ${tableName} SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL`).run(token.id);

    return {
      userId: token.user_id,
      tokenId: token.id,
    };
  });
}

/**
 * Verify password reset token
 */
async function verifyPasswordResetToken(rawToken) {
  return verifyOneTimeToken(rawToken, "password_reset_tokens");
}

/**
 * Mark password reset token as used
 */
async function markPasswordResetTokenUsed(tokenId) {
  await db.prepare("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(tokenId);
}

/**
 * Invalidate all password reset tokens for user
 */
async function invalidateAllPasswordResetTokens(userId) {
  await db.prepare("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL").run(
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

  await db.prepare(
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
  return verifyOneTimeToken(rawToken, "email_verification_tokens");
}

/**
 * Mark email verification token as used
 */
async function markEmailVerificationTokenUsed(tokenId) {
  await db.prepare("UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(tokenId);
}

// ==================== SESSION MANAGEMENT ====================

/**
 * Create a session for user
 */
async function createSession(userId, sessionData = {}) {
  if (!userId) {
    throw new Error("INVALID_USER_ID: userId is required to create session.");
  }
  const sessionId = generateId("sess");

  await db.prepare(
    `INSERT INTO user_sessions (id, user_id, device_name, ip_address, user_agent, last_active_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
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
  const rows = await db
    .prepare(
      `SELECT id, user_id, device_name, ip_address, user_agent, last_active_at, created_at
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY last_active_at DESC`
    )
    .all(userId);
  return rows.map((row) => ({
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
  await db.prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
}

/**
 * Revoke all sessions except the current one
 */
async function revokeAllSessionsExcept(userId, currentSessionId) {
  await db.prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id != ?").run(
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

  await db.prepare(
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
  const user = await db.prepare("SELECT failed_login_count FROM users WHERE id = ?").get(userId);
  const newCount = (user?.failed_login_count || 0) + 1;

  if (newCount >= config.maxFailedLoginAttempts) {
    // Escalating lockout: double the duration on each consecutive lockout.
    // Lockout count = how many times the threshold has been hit (consecutive failures / threshold).
    // e.g. base=15min → 15, 30, 60, 120, ... minutes on repeated lockouts.
    const lockoutCount = Math.floor(newCount / config.maxFailedLoginAttempts);
    const escalatedMinutes = config.lockoutDurationMinutes * Math.pow(2, lockoutCount - 1);

    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + escalatedMinutes);

    await db.prepare("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?").run(
      newCount,
      lockedUntil.toISOString(),
      userId
    );
  } else {
    await db.prepare("UPDATE users SET failed_login_count = ? WHERE id = ?").run(newCount, userId);
  }
}

/**
 * Check if account is locked
 */
async function isAccountLocked(userId) {
  const user = await db.prepare("SELECT locked_until FROM users WHERE id = ?").get(userId);

  if (!user?.locked_until) {
    return false;
  }

  return new Date(user.locked_until) > new Date();
}

/**
 * Reset failed login count (on successful login)
 */
async function resetFailedLoginCount(userId) {
  await db.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?").run(userId);
}

// ==================== ACCOUNT DELETION (GDPR Article 17) ====================

/**
 * Delete user account and all associated data
 * Performs cascading deletion in dependency order, then soft-deletes the user.
 * @param {string} userId - User ID to delete
 * @throws {Error} If user not found
 */
async function deleteUserAccount(userId) {
  // Verify user exists
  const user = await db.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").get(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const now = new Date().toISOString();

  // Transaction for atomic deletion
  await db.transaction(async () => {
    // 1. Story data (deepest first)
    await db.prepare(`
      DELETE FROM story_turns WHERE session_id IN
      (SELECT id FROM story_sessions WHERE user_id = ?)
    `).run(userId);
    await db.prepare("DELETE FROM story_sessions WHERE user_id = ?").run(userId);

    // 2. Share data (depends on tracks)
    await db.prepare(`
      DELETE FROM share_access_log WHERE share_token_id IN
      (SELECT id FROM share_tokens WHERE track_id IN
       (SELECT id FROM tracks WHERE user_id = ?))
    `).run(userId);
    await db.prepare(`
      DELETE FROM share_tokens WHERE track_id IN
      (SELECT id FROM tracks WHERE user_id = ?)
    `).run(userId);

    // 3. Track data (deepest first: jobs → track_versions → tracks)
    await db.prepare(`
      DELETE FROM jobs WHERE track_version_id IN
      (SELECT id FROM track_versions WHERE track_id IN
       (SELECT id FROM tracks WHERE user_id = ?))
    `).run(userId);
    await db.prepare(`
      DELETE FROM track_versions WHERE track_id IN
      (SELECT id FROM tracks WHERE user_id = ?)
    `).run(userId);
    await db.prepare("DELETE FROM tracks WHERE user_id = ?").run(userId);

    // 4. Poems
    await db.prepare("DELETE FROM poems WHERE user_id = ?").run(userId);

    // 5. Billing & entitlements
    await db.prepare("DELETE FROM billing_holds WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM credit_transactions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM purchase_receipts WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM subscriptions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM entitlements WHERE user_id = ?").run(userId);

    // 6. Voice data
    await db.prepare("DELETE FROM enrollment_sessions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM voice_profiles WHERE user_id = ?").run(userId);

    // 7. Rate limits
    await db.prepare("DELETE FROM rate_limits WHERE user_id = ?").run(userId);

    // 8. Auth tables (CASCADE handles most via FK constraints)
    // Explicit deletes for tables that might not have CASCADE set up
    await db.prepare("DELETE FROM auth_events WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM token_families WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_auth_providers WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(userId);

    // 9. Soft-delete user (preserve audit trail, anonymize PII)
    await db.prepare(`
      UPDATE users SET
        email = 'deleted_' || id || '@deleted.local',
        display_name = 'Deleted User',
        avatar_url = NULL,
        deleted_at = ?
      WHERE id = ?
    `).run(now, userId);
  });
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
  getJwtFingerprint,

  // Refresh tokens
  createRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  compromiseAllTokenFamiliesForUser,
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

  // Account deletion
  deleteUserAccount,
};
