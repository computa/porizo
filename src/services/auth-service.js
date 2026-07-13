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
const {
  createAccountDeletionRepository,
} = require("../database/account-deletion-repository");
const {
  createAuthSessionRepository,
} = require("../database/auth-session-repository");
const {
  createAuthSecurityRepository,
} = require("../database/auth-security-repository");
const {
  createAuthOneTimeTokenRepository,
} = require("../database/auth-one-time-token-repository");
const {
  createAuthRefreshTokenRepository,
} = require("../database/auth-refresh-token-repository");
const {
  createGdprDataExportRepository,
} = require("../database/gdpr-data-export-repository");
const { createGdprAuditRepository } = require("../database/gdpr-audit-repository");
const {
  revokeAllEnrollmentSessionTokensForUser,
} = require("./enrollment-session-service");
const {
  createAccountCleanupRepository,
} = require("../database/account-cleanup-repository");
const {
  deleteVoiceProviderJobsForUser,
  listProviderProfilesForUser,
  softDeleteProviderProfilesForUser,
} = require("./voice-provider-profile-service");
const { identityHash } = require("./identity-service");

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
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "CRITICAL: JWT_SECRET must be at least 32 characters long for security.",
    );
  }
  return secret;
}

// Configuration with secure defaults
// Token lifetimes optimized for mobile apps (Spotify-style persistent login)
// - 15 minute access tokens: short-lived bearer credentials
// - 90 day refresh tokens: keeps active users logged in long-term
// NOTE: jwtSecret is intentionally lazy — getJwtSecret() is NOT called at module load time.
// This prevents startup crashes when JWT_SECRET is injected after module import (e.g. in tests).
// The secret is resolved on first use via the jwt* functions below.
const config = {
  bcryptCost: 12,
  accessTokenExpiry: "15m",
  refreshTokenExpiryDays: 90,
  passwordResetExpiryMinutes: 30,
  emailVerificationExpiryDays: 7,
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  get jwtSecret() {
    return getJwtSecret();
  },
  jwtIssuer: "porizo",
};

function getJwtFingerprint() {
  return {
    issuer: config.jwtIssuer,
    accessTokenExpiry: config.accessTokenExpiry,
    refreshTokenExpiryDays: config.refreshTokenExpiryDays,
    secretHash: crypto
      .createHash("sha256")
      .update(config.jwtSecret)
      .digest("hex")
      .slice(0, 12),
  };
}

// Database instance (initialized via initialize())
let db = null;
let authSessionRepository = null;
let authSecurityRepository = null;
let authOneTimeTokenRepository = null;
let authRefreshTokenRepository = null;
let gdprDataExportRepository = null;

/**
 * Initialize the auth service with database instance
 */
function initialize(database) {
  db = database;
  authSessionRepository = createAuthSessionRepository(database);
  authSecurityRepository = createAuthSecurityRepository(database);
  authOneTimeTokenRepository = createAuthOneTimeTokenRepository(database);
  authRefreshTokenRepository = createAuthRefreshTokenRepository(database);
  gdprDataExportRepository = createGdprDataExportRepository(database);
}

function getAuthSessionRepository() {
  if (!authSessionRepository) {
    if (!db) {
      throw new Error("Auth service has not been initialized with a database");
    }
    authSessionRepository = createAuthSessionRepository(db);
  }
  return authSessionRepository;
}

function getAuthSecurityRepository() {
  if (!authSecurityRepository) {
    if (!db) {
      throw new Error("Auth service has not been initialized with a database");
    }
    authSecurityRepository = createAuthSecurityRepository(db);
  }
  return authSecurityRepository;
}

function getAuthOneTimeTokenRepository() {
  if (!authOneTimeTokenRepository) {
    if (!db) {
      throw new Error("Auth service has not been initialized with a database");
    }
    authOneTimeTokenRepository = createAuthOneTimeTokenRepository(db);
  }
  return authOneTimeTokenRepository;
}

function getAuthRefreshTokenRepository() {
  if (!authRefreshTokenRepository) {
    if (!db) {
      throw new Error("Auth service has not been initialized with a database");
    }
    authRefreshTokenRepository = createAuthRefreshTokenRepository(db);
  }
  return authRefreshTokenRepository;
}

function getGdprDataExportRepository() {
  if (!gdprDataExportRepository) {
    if (!db) {
      throw new Error("Auth service has not been initialized with a database");
    }
    gdprDataExportRepository = createGdprDataExportRepository(db);
  }
  return gdprDataExportRepository;
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

const { generateId } = require("../utils/ids");

// ==================== JWT ACCESS TOKENS ====================

/**
 * Generate JWT access token
 */
function generateAccessToken(userId, options = {}) {
  const expiresIn = options.expiresIn || config.accessTokenExpiry;
  const payload = { sub: userId };

  if (options.sessionId) {
    payload.sid = options.sessionId;
  }

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn,
    issuer: config.jwtIssuer,
  });
}

/**
 * Verify and decode JWT access token
 * Throws on invalid/expired token
 */
function verifyAccessToken(token, options = {}) {
  const defaultClockToleranceSec = process.env.NODE_ENV === "test" ? 0 : 5;
  return jwt.verify(token, config.jwtSecret, {
    issuer: config.jwtIssuer,
    // Allow 5s clock drift in non-test env (industry standard). Was 30s — reduced to limit
    // the window where an expired token could still be accepted.
    clockTolerance: options.clockToleranceSec ?? defaultClockToleranceSec,
  });
}

// ==================== REFRESH TOKENS ====================

/**
 * Create a new refresh token for user
 * Returns raw token (to send to client), plus metadata
 */
async function createRefreshToken(userId, options = {}) {
  const refreshTokenRepository = getAuthRefreshTokenRepository();
  const expiresIn = options.expiresIn ?? config.refreshTokenExpiryDays;
  const sessionId = options.sessionId ?? null;

  // Create token family first
  const familyId = generateId("tf");
  await refreshTokenRepository.insertTokenFamily({
    id: familyId,
    userId,
    sessionId,
  });

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
  if (sessionId) {
    const session = await getAuthSessionRepository().findSessionLifetime(sessionId);
    if (!session) throw new Error("Session not found or revoked");
    const absoluteExpiry = new Date(session.absolute_expires_at);
    if (absoluteExpiry <= new Date()) throw new Error("Session has expired");
    if (expiresAt > absoluteExpiry) expiresAt.setTime(absoluteExpiry.getTime());
  }

  await refreshTokenRepository.insertRefreshToken({
    id: tokenId,
    userId,
    tokenHash,
    tokenFamily: familyId,
    generation: 1,
    expiresAt: expiresAt.toISOString(),
  });

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
  const refreshTokenRepository = getAuthRefreshTokenRepository();
  const tokenHash = hashToken(rawToken);

  // Look up token by hash
  const token = await refreshTokenRepository.findTokenForVerification(tokenHash);

  if (!token) {
    throw new Error("Token not found or invalid");
  }

  // Check if family is compromised (reuse attack detected)
  if (token.family_compromised) {
    throw new Error("Token family compromised");
  }

  if (!token.session_id) {
    const err = new Error("Refresh token session binding is missing");
    err.code = "SESSION_BINDING_REQUIRED";
    throw err;
  }

  if (token.session_revoked_at) {
    throw new Error("Session has been revoked");
  }
  const now = new Date();
  if (
    (token.session_idle_expires_at && new Date(token.session_idle_expires_at) <= now) ||
    (token.session_absolute_expires_at && new Date(token.session_absolute_expires_at) <= now)
  ) {
    throw new Error("Session has expired");
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
    sessionId: token.session_id || null,
  };
}

/**
 * Revoke a refresh token by ID
 */
async function revokeRefreshToken(tokenId) {
  await getAuthRefreshTokenRepository().revokeToken(tokenId);
}

/**
 * Revoke all refresh tokens for a user (batch operation)
 * Used on logout, password change, and security events
 *
 * @param {string} userId - User ID
 * @returns {number} Number of tokens revoked
 */
async function revokeAllRefreshTokensForUser(userId) {
  const result =
    await getAuthRefreshTokenRepository().revokeActiveTokensForUser(userId);
  authLogger.info(
    { userId, tokensRevoked: result.changes },
    "All refresh tokens revoked (logout)",
  );
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
  const result =
    await getAuthRefreshTokenRepository().compromiseActiveTokenFamiliesForUser(
      userId,
    );
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
  const refreshTokenRepository = getAuthRefreshTokenRepository();
  const oldTokenHash = hashToken(oldRawToken);

  // Pre-generate new token values (crypto operations outside transaction)
  const newRawToken = generateSecureToken();
  const newTokenHash = hashToken(newRawToken);
  const newTokenId = generateId("rt");
  let expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.refreshTokenExpiryDays);

  const parseDbTimestamp = (value) => {
    if (!value) return null;
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)
    ) {
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
    result = await refreshTokenRepository.transaction(async (txRepository) => {
      // Get old token with fresh read inside transaction
      const oldToken = await txRepository.findTokenByHash(oldTokenHash);

      if (!oldToken) {
        const err = new Error("Token not found");
        err.code = "TOKEN_NOT_FOUND";
        throw err;
      }

      // Check if already revoked (possible reuse attack!)
      if (oldToken.revoked_at) {
        const revokedAt = parseDbTimestamp(oldToken.revoked_at);
        const gracePeriodMs = 30 * 1000; // 30 second grace period for app kill scenarios
        const timeSinceRevocation = revokedAt
          ? Date.now() - revokedAt.getTime()
          : Number.POSITIVE_INFINITY;

        // If revoked within grace period, this is likely an app that was killed during refresh
        // Find and check if a replacement token was already issued
        if (timeSinceRevocation < gracePeriodMs) {
          const replacementToken =
            await txRepository.findActiveReplacementToken({
              tokenFamily: oldToken.token_family,
              generation: oldToken.generation + 1,
            });

          if (replacementToken) {
            // A new token was already issued - client needs to re-authenticate
            // but we DON'T mark the family as compromised (not a real attack)
            authLogger.info(
              { timeSinceRevocation, hasReplacement: true },
              "Token reuse within grace period - replacement exists, requesting re-auth",
            );
            const err = new Error(
              "Token already rotated - please re-authenticate",
            );
            err.code = "TOKEN_ALREADY_ROTATED";
            throw err;
          }

          // Within grace period but no replacement token - likely a failed/interrupted refresh
          // Allow this token to be reused (un-revoke it and proceed normally)
          // This handles edge cases like server crash during token rotation
          authLogger.warn(
            {
              audit_event: "refresh_token_grace_unrevoke",
              severity: "HIGH",
              timeSinceRevocation,
              hasReplacement: false,
              tokenId: oldToken.id,
              tokenFamily: oldToken.token_family,
            },
            "Token reuse within grace period - no replacement, allowing reuse after high-severity audit event",
          );
          // Persist a HIGH-severity audit_logs row so SOC review tooling can
          // detect this defense-in-depth event (it can also be a real reuse
          // attack that happens to land inside the 30s grace window).
          try {
            await txRepository.insertGraceUnrevokeAuditLog({
              id: generateId("audit"),
              userId: oldToken.user_id,
              tokenId: oldToken.id,
              tokenFamily: oldToken.token_family,
              generation: oldToken.generation,
              timeSinceRevocationMs: timeSinceRevocation,
              createdAt: new Date().toISOString(),
            });
          } catch (auditErr) {
            // Audit-log failures must not block the user's refresh flow,
            // but they should be loud in logs so monitoring can alert.
            authLogger.error(
              { err: auditErr, tokenId: oldToken.id },
              "Failed to persist refresh_token_grace_unrevoke audit event",
            );
          }
          await txRepository.clearTokenRevocation(oldToken.id);
          // Continue with normal rotation flow - the token is now un-revoked
          // Fall through to the rest of the function
        } else {
          // Outside grace period = potential attack, compromise the family
          authLogger.warn(
            { timeSinceRevocation, tokenFamily: oldToken.token_family },
            "Token reuse detected outside grace period - compromising family",
          );

          // Mark entire family as compromised
          await txRepository.compromiseTokenFamily(oldToken.token_family);

          // Revoke all tokens in family
          await txRepository.revokeTokensInFamily(oldToken.token_family);

          return {
            reuseDetected: true,
            tokenFamily: oldToken.token_family,
          };
        }
      }

      // Check if family already compromised
      const family = await txRepository.findTokenFamilyWithSession(
        oldToken.token_family,
      );
      if (family.compromised_at) {
        const err = new Error("Token family compromised");
        err.code = "TOKEN_FAMILY_COMPROMISED";
        throw err;
      }
      if (!family.session_id) {
        const err = new Error("Refresh token session binding is missing");
        err.code = "SESSION_BINDING_REQUIRED";
        throw err;
      }
      if (family.session_revoked_at) {
        const err = new Error("Session has been revoked");
        err.code = "SESSION_REVOKED";
        throw err;
      }
      const rotatedAt = new Date();
      if (
        (family.session_idle_expires_at && new Date(family.session_idle_expires_at) <= rotatedAt) ||
        (family.session_absolute_expires_at && new Date(family.session_absolute_expires_at) <= rotatedAt)
      ) {
        const err = new Error("Session has expired");
        err.code = "SESSION_EXPIRED";
        throw err;
      }
      const absoluteExpiry = new Date(family.session_absolute_expires_at);
      if (expiresAt > absoluteExpiry) expiresAt = absoluteExpiry;

      // Revoke old token using optimistic locking to prevent TOCTOU race
      // The conditional WHERE revoked_at IS NULL ensures only ONE concurrent
      // refresh request can succeed - others will get changes=0
      const revokeResult = await txRepository.revokeActiveToken(oldToken.id);

      // If no rows affected, another concurrent request already revoked this token
      if (revokeResult.changes === 0) {
        // Re-check if a replacement token was created (within grace period scenario)
        const replacementToken =
          await txRepository.findActiveReplacementToken({
            tokenFamily: oldToken.token_family,
            generation: oldToken.generation + 1,
          });

        if (replacementToken) {
          authLogger.info(
            { tokenId: oldToken.id, hasReplacement: true },
            "Concurrent token rotation detected - replacement exists",
          );
          const err = new Error(
            "Token already rotated - please re-authenticate",
          );
          err.code = "TOKEN_ALREADY_ROTATED";
          throw err;
        }

        // No replacement but couldn't revoke - unexpected state, fail safely
        authLogger.warn(
          { tokenId: oldToken.id },
          "Concurrent token rotation detected - no replacement found, failing safely",
        );
        const err = new Error("Token rotation conflict - please retry");
        err.code = "TOKEN_ROTATION_CONFLICT";
        throw err;
      }

      // Create new token in same family
      const newGeneration = oldToken.generation + 1;
      await txRepository.insertRefreshToken({
        id: newTokenId,
        userId: oldToken.user_id,
        tokenHash: newTokenHash,
        tokenFamily: oldToken.token_family,
        generation: newGeneration,
        expiresAt: expiresAt.toISOString(),
      });

      const idleExpiry = new Date(
        Math.min(
          rotatedAt.getTime() + 90 * 24 * 60 * 60 * 1000,
          absoluteExpiry.getTime(),
        ),
      );
      await txRepository.touchSession({
        sessionId: family.session_id,
        lastActiveAt: rotatedAt.toISOString(),
        idleExpiresAt: idleExpiry.toISOString(),
        lastRotatedAt: rotatedAt.toISOString(),
      });

      return {
        userId: oldToken.user_id,
        tokenFamily: oldToken.token_family,
        generation: newGeneration,
        sessionId: family.session_id || null,
      };
    });
  } catch (err) {
    if (
      err?.code === "ERR_SQLITE_ERROR" &&
      /locked|busy|cannot start a transaction within a transaction/i.test(
        String(err.message || ""),
      )
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
    {
      userId: result.userId,
      tokenFamily: result.tokenFamily,
      generation: result.generation,
    },
    "Token rotated successfully",
  );

  return {
    userId: result.userId,
    token: newRawToken,
    tokenId: newTokenId,
    tokenFamily: result.tokenFamily,
    generation: result.generation,
    expiresAt: expiresAt.toISOString(),
    sessionId: result.sessionId || null,
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

  await getAuthOneTimeTokenRepository().insertPasswordResetToken({
    id: tokenId,
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    token: rawToken,
    tokenId,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Verify a one-time token (password reset or email verification)
 * @param {string} rawToken - The raw token to verify
 * @param {string} tokenType - The one-time token aggregate to query
 * @returns {Promise<{userId: string, tokenId: string}>}
 */
async function verifyOneTimeToken(rawToken, tokenType) {
  const tokenHash = hashToken(rawToken);
  const token = await getAuthOneTimeTokenRepository().consumeOneTimeToken({
    tokenType,
    tokenHash,
  });

  return {
    userId: token.user_id,
    tokenId: token.id,
    email_normalized: token.email_normalized || null,
    contact_id: token.contact_id || null,
  };
}

/**
 * Verify password reset token
 */
async function verifyPasswordResetToken(rawToken) {
  return verifyOneTimeToken(rawToken, "password_reset");
}

/**
 * Mark password reset token as used
 */
async function markPasswordResetTokenUsed(tokenId) {
  await getAuthOneTimeTokenRepository().markTokenUsed({
    tokenType: "password_reset",
    tokenId,
  });
}

/**
 * Invalidate all password reset tokens for user
 */
async function invalidateAllPasswordResetTokens(userId) {
  await getAuthOneTimeTokenRepository().invalidateActiveTokensForUser({
    tokenType: "password_reset",
    userId,
  });
}

// ==================== EMAIL VERIFICATION TOKENS ====================

/**
 * Create email verification token
 */
async function createEmailVerificationToken(userId, options = {}) {
  const emailNormalized = options.email
    ? String(options.email).trim().toLowerCase()
    : null;
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const tokenId = generateId("evt");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.emailVerificationExpiryDays);

  await getAuthOneTimeTokenRepository().insertEmailVerificationToken({
    id: tokenId,
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    emailNormalized,
  });

  return {
    token: rawToken,
    tokenId,
    expiresAt: expiresAt.toISOString(),
    emailNormalized,
  };
}

/**
 * Verify email verification token
 */
async function verifyEmailVerificationToken(rawToken) {
  return verifyOneTimeToken(rawToken, "email_verification");
}

/**
 * Invalidate all outstanding email verification tokens for a user.
 * Used when the pending email target changes.
 */
async function invalidateEmailVerificationTokens(userId) {
  await getAuthOneTimeTokenRepository().invalidateActiveTokensForUser({
    tokenType: "email_verification",
    userId,
  });
}

/**
 * Mark email verification token as used
 */
async function markEmailVerificationTokenUsed(tokenId) {
  await getAuthOneTimeTokenRepository().markTokenUsed({
    tokenType: "email_verification",
    tokenId,
  });
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
  const createdAt = new Date();
  const authenticatedAt = sessionData.authenticatedAt || createdAt.toISOString();
  const idleExpiresAt = new Date(
    createdAt.getTime() + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const absoluteExpiresAt = new Date(
    createdAt.getTime() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await getAuthSessionRepository().insertSession({
    id: sessionId,
    userId,
    deviceName: sessionData.deviceName || null,
    ipAddress: sessionData.ipAddress || null,
    userAgent: sessionData.userAgent || null,
    authMethod: sessionData.authMethod || null,
    platform: sessionData.platform || null,
    authenticatedAt,
    idleExpiresAt,
    absoluteExpiresAt,
    lastRotatedAt: createdAt.toISOString(),
  });

  return {
    id: sessionId,
    userId,
    deviceName: sessionData.deviceName,
    ipAddress: sessionData.ipAddress,
    userAgent: sessionData.userAgent,
    authMethod: sessionData.authMethod,
    platform: sessionData.platform,
    authenticatedAt,
    idleExpiresAt,
    absoluteExpiresAt,
  };
}

/** Create a native session and its first refresh token on caller-owned repositories. */
async function createSessionAndRefreshTokenInTransaction(
  userId,
  sessionData,
  { sessionRepository, refreshTokenRepository },
) {
  if (!userId || !sessionRepository || !refreshTokenRepository) {
    throw new Error("TRANSACTION_BOUND_SESSION_REPOSITORIES_REQUIRED");
  }
  const now = new Date();
  const sessionId = generateId("sess");
  const familyId = generateId("tf");
  const tokenId = generateId("rt");
  const rawToken = generateSecureToken();
  const idleExpiresAt = new Date(
    now.getTime() + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const absoluteExpiresAt = new Date(
    now.getTime() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    Math.min(
      now.getTime() + config.refreshTokenExpiryDays * 24 * 60 * 60 * 1000,
      Date.parse(absoluteExpiresAt),
    ),
  ).toISOString();

  await sessionRepository.insertSession({
    id: sessionId,
    userId,
    deviceName: sessionData.deviceName || null,
    ipAddress: sessionData.ipAddress || null,
    userAgent: sessionData.userAgent || null,
    authMethod: sessionData.authMethod || "magic_email",
    platform: sessionData.platform,
    authenticatedAt: now.toISOString(),
    idleExpiresAt,
    absoluteExpiresAt,
    lastRotatedAt: now.toISOString(),
  });
  await refreshTokenRepository.insertTokenFamily({
    id: familyId,
    userId,
    sessionId,
  });
  await refreshTokenRepository.insertRefreshToken({
    id: tokenId,
    userId,
    tokenHash: hashToken(rawToken),
    tokenFamily: familyId,
    generation: 1,
    expiresAt: refreshExpiresAt,
  });
  return {
    sessionId,
    tokenFamily: familyId,
    refreshToken: rawToken,
    refreshExpiresAt,
    absoluteExpiresAt,
  };
}

/**
 * List active sessions for user (not revoked)
 */
async function listSessions(userId) {
  return getAuthSessionRepository().listActiveSessions(userId);
}

async function verifyActiveUser({ userId }) {
  if (!userId) return false;
  const user = await getAuthSessionRepository().findActiveUser(userId);
  return Boolean(user);
}

async function verifyActiveSessionForUser({ userId, sessionId }) {
  if (!userId || !sessionId) return false;
  const session = await getAuthSessionRepository().findActiveSession({
    userId,
    sessionId,
  });
  return Boolean(session);
}

async function verifyRecentAuthentication({
  userId,
  sessionId,
  maxAgeMs = 15 * 60 * 1000,
}) {
  const session = await getAuthSessionRepository().findSessionLifetime(sessionId);
  if (!session || session.user_id !== userId || !session.authenticated_at) {
    return false;
  }
  return Date.now() - Date.parse(session.authenticated_at) <= maxAgeMs;
}

/**
 * Revoke a session
 */
async function revokeSession(sessionId) {
  await getAuthSessionRepository().revokeSession(sessionId);
}

/**
 * Revoke all sessions except the current one
 */
async function revokeAllSessionsExcept(userId, currentSessionId) {
  await getAuthSessionRepository().revokeAllSessionsExcept(
    userId,
    currentSessionId,
  );
}

// ==================== AUTH EVENTS (AUDIT) ====================

/**
 * Log an authentication event
 */
async function logAuthEvent({
  userId,
  eventType,
  ipAddress,
  userAgent,
  metadata,
}) {
  const eventId = generateId("evt");

  await getAuthSecurityRepository().insertAuthEvent({
    id: eventId,
    userId: userId || null,
    eventType,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
  });

  return eventId;
}

// ==================== ACCOUNT LOCKOUT ====================

/**
 * Increment failed login count for user
 * Locks account if threshold reached
 */
async function incrementFailedLoginCount(userId) {
  // Atomic increment — prevents lost updates from concurrent failed logins
  await getAuthSecurityRepository().incrementFailedLoginCount(userId);

  // Read back the atomically-incremented count for lockout decision
  const user = await getAuthSecurityRepository().findLoginLockoutState(userId);
  const newCount = user?.failed_login_count || 0;

  if (newCount >= config.maxFailedLoginAttempts) {
    // Escalating lockout: double the duration on each consecutive lockout.
    // Lockout count = how many times the threshold has been hit (consecutive failures / threshold).
    // e.g. base=15min → 15, 30, 60, 120, ... minutes on repeated lockouts.
    const lockoutCount = Math.floor(newCount / config.maxFailedLoginAttempts);
    const escalatedMinutes =
      config.lockoutDurationMinutes * Math.pow(2, lockoutCount - 1);

    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + escalatedMinutes);

    await getAuthSecurityRepository().setAccountLockedUntil({
      userId,
      lockedUntil: lockedUntil.toISOString(),
    });
  }
}

/**
 * Check if account is locked
 */
async function isAccountLocked(userId) {
  const user = await getAuthSecurityRepository().findLoginLockoutState(userId);

  if (!user?.locked_until) {
    return false;
  }

  return new Date(user.locked_until) > new Date();
}

/**
 * Reset failed login count (on successful login)
 */
async function resetFailedLoginCount(userId) {
  await getAuthSecurityRepository().resetFailedLoginCount(userId);
}

// ==================== ACCOUNT DELETION (GDPR Article 17) ====================

/**
 * Delete user account and all associated data
 * Performs cascading deletion in dependency order, then soft-deletes the user.
 * @param {string} userId - User ID to delete
 * @throws {Error} If user not found
 */
async function deleteUserAccount(
  userId,
  { accountDeletionAuditLog = null } = {},
) {
  const accountDeletionRepository = createAccountDeletionRepository(db);
  const now = new Date().toISOString();

  await accountDeletionRepository.transaction(async (accountDeletionTx, txDb) => {
    const gdprAuditRepository = createGdprAuditRepository(txDb);
    const accountCleanupRepository = createAccountCleanupRepository(txDb);

    await accountDeletionTx.lockUserScopedTablesForAccountDeletion();
    const user = await accountDeletionTx.findActiveUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Capture identity/trial state before provider and entitlement rows disappear.
    const {
      providers: tombstoneProviders,
      hadTrial: tombstoneHadTrial,
    } = await accountDeletionTx.getDeletionTombstoneContext(userId);

    // Tombstone the account before child cleanup. With the Postgres table locks
    // above, concurrent account-owned writes either commit before this cascade
    // sees them or wait until the deleted-user write guards reject them.
    await accountDeletionTx.softDeleteUser({ userId, deletedAt: now });
    await accountDeletionTx.anonymizeAuditLogsForUser(userId);

    await accountDeletionTx.deleteStoryRowsForUser(userId);
    await accountDeletionTx.deleteShareRowsForUser(userId);
    await accountDeletionTx.deleteTrackRowsForUser(userId);
    await accountDeletionTx.deletePoemRowsForUser(userId);
    await accountDeletionTx.deleteGiftRowsForUser(userId);
    await accountDeletionTx.deleteBillingRowsForUser(userId);

    // Voice data. Scrub provider-side raw IDs before deleting parent voice
    // rows; the retained audit row below keeps only local lifecycle metadata.
    const providerProfiles = await listProviderProfilesForUser(txDb, {
      userId,
    });
    if (providerProfiles.length > 0) {
      await softDeleteProviderProfilesForUser(txDb, {
        userId,
        reason: "account_deletion",
        deletedAt: now,
      });
      await accountDeletionTx.insertVoiceProviderProfilesDeletedAudit({
        id: `aud_${crypto.randomBytes(12).toString("hex")}`,
        userId,
        providerProfiles,
        createdAt: now,
      });
    }
    await deleteVoiceProviderJobsForUser(txDb, { userId });
    // U3: token revocation goes through enrollment-domain service.
    await revokeAllEnrollmentSessionTokensForUser(txDb, userId);
    await accountDeletionTx.deleteEnrollmentAndVoiceRowsForUser(userId);

    await accountDeletionTx.deleteRateLimitRowsForUser(userId);
    await accountDeletionTx.scrubTelemetryAndAttributionRowsForUser(userId);

    // Retain auth_events as non-PII security evidence while clearing raw request data.
    await accountDeletionTx.anonymizeAuthEventsForUser(userId);
    await accountDeletionTx.deleteAuthTokenAndSessionRowsForUser(userId);

    await accountDeletionTx.insertGrantedIdentityTombstones({
      identityHashes: tombstoneProviders
        .filter((provider) => provider.provider && provider.provider_user_id)
        .map((provider) =>
          identityHash(provider.provider, provider.provider_user_id),
        ),
      hadTrial: tombstoneHadTrial,
    });

    await accountDeletionTx.deleteAuthProviderAndCredentialRowsForUser(userId);
    await accountDeletionTx.deleteContactRowsForUser(userId);

    // Emit retained no-PII GDPR/security evidence after all destructive steps,
    // so any insert failure rolls the entire cascade back.
    if (accountDeletionAuditLog) {
      await gdprAuditRepository.insertAuditLog(accountDeletionAuditLog);
    }

    await accountDeletionTx.insertAccountDeletedAuthEvent({
      id: generateId("evt"),
      userId,
    });

    // Commit a durable cleanup request with the tombstone. External storage is
    // irreversible and must only be touched after this transaction commits.
    await accountCleanupRepository.enqueue({
      id: generateId("acj"),
      userId,
      idempotencyKey: `account:${userId}`,
      maxAttempts: 5,
      now,
    });
  });
}

/**
 * Export all personal data held for a user (GDPR Article 20 portability).
 * Read-only counterpart to deleteUserAccount: assembles the user-scoped rows
 * across the same domain tables into a single JSON bundle.
 *
 * Secrets and internal references are redacted by column name (password hashes,
 * embeddings, stream keys, raw receipt blobs, provider-side ids) — the export
 * gives the user THEIR data, never credentials or other people's data. Each
 * section is wrapped so a table/column that differs between Postgres (prod) and
 * the sql.js test DB can't abort the whole export.
 *
 * @param {string} userId
 * @returns {Promise<object>} export bundle
 */
async function exportUserData(userId) {
  const dataExportRepository = getGdprDataExportRepository();
  const user = await dataExportRepository.findActiveUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  // Column names redacted from every exported row.
  const REDACT = new Set([
    "password_hash",
    "embedding",
    "embedding_ref",
    "stream_key",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "provider_profile_id",
    "source_upload_url",
    "source_audio_id",
    "source_task_id",
    "receipt_data",
    "latest_receipt",
    "signed_payload",
    "jws_representation",
    "transaction_jws",
  ]);
  const scrub = (rows) =>
    (rows || []).map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        if (!REDACT.has(k)) {
          out[k] = v;
        }
      }
      return out;
    });

  const sections = await dataExportRepository.listUserExportSections(userId);
  const data = Object.fromEntries(
    Object.entries(sections).map(([name, rowsOrError]) => [
      name,
      Array.isArray(rowsOrError) ? scrub(rowsOrError) : rowsOrError,
    ]),
  );

  return {
    export_format: "json",
    generated_at: new Date().toISOString(),
    user_id: userId,
    data,
  };
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
  invalidateEmailVerificationTokens,

  // Sessions
  createSession,
  createSessionAndRefreshTokenInTransaction,
  listSessions,
  verifyActiveUser,
  verifyActiveSessionForUser,
  verifyRecentAuthentication,
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

  // GDPR data export (Article 20)
  exportUserData,
};
