/**
 * Authentication Routes
 *
 * Handles user signup, login, social auth, token refresh,
 * password reset, and email verification.
 */

const authService = require("../services/auth-service");
const emailService = require("../services/email-service");
const gdprAuditService = require("../services/gdpr-audit-service");
const { verifySocialToken, isProviderConfigured } = require("../services/social-token-verifier");
const crypto = require("crypto");

// Rate limit tracking (in-memory for now, Redis in production)
const rateLimits = new Map();

/**
 * Clear all rate limits (for testing only)
 */
function clearRateLimits() {
  rateLimits.clear();
}

/**
 * Check rate limit
 * @param {string} key - Rate limit key (e.g., "login:192.168.1.1")
 * @param {number} maxAttempts - Maximum attempts in window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} - true if rate limited
 */
function isRateLimited(key, maxAttempts, windowMs) {
  const now = Date.now();
  const record = rateLimits.get(key);

  if (!record) {
    rateLimits.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (now - record.windowStart > windowMs) {
    // Window expired, reset
    rateLimits.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (record.count >= maxAttempts) {
    return true;
  }

  record.count++;
  return false;
}

/**
 * Helper to send standardized error response
 */
function sendError(reply, statusCode, errorCode, message) {
  return reply.status(statusCode).send({
    error: errorCode,
    message,
  });
}

/**
 * Extract client IP from request
 */
function getClientIp(request) {
  return (
    request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    request.headers["x-real-ip"] ||
    request.ip ||
    "unknown"
  );
}

/**
 * Generate unique user ID
 */
function generateUserId() {
  return `user_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Register auth routes on Fastify app
 */
function registerAuthRoutes(app, { db }) {
  // Initialize services with database
  authService.initialize(db);
  gdprAuditService.initialize(db);

  // ==================== SCHEMAS ====================

  const signupSchema = {
    body: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email", maxLength: 255 },
        password: { type: "string", minLength: 8, maxLength: 72 },
        name: { type: "string", maxLength: 100 },
        locale: { type: "string", maxLength: 10 },
        country: { type: "string", maxLength: 2 },
      },
    },
  };

  const loginSchema = {
    body: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email" },
        password: { type: "string" },
      },
    },
  };

  const socialAuthSchema = {
    body: {
      type: "object",
      required: ["provider", "id_token"],
      properties: {
        provider: { type: "string", enum: ["apple", "google"] },
        id_token: { type: "string" },
        name: { type: "string", maxLength: 100 },
      },
    },
  };

  const refreshSchema = {
    body: {
      type: "object",
      required: ["refresh_token"],
      properties: {
        refresh_token: { type: "string" },
      },
    },
  };

  const forgotPasswordSchema = {
    body: {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", format: "email" },
      },
    },
  };

  const resetPasswordSchema = {
    body: {
      type: "object",
      required: ["token", "new_password"],
      properties: {
        token: { type: "string" },
        new_password: { type: "string", minLength: 8, maxLength: 72 },
      },
    },
  };

  const verifyEmailSchema = {
    body: {
      type: "object",
      required: ["token"],
      properties: {
        token: { type: "string" },
      },
    },
  };

  // ==================== SIGNUP ====================

  app.post("/auth/signup", { schema: signupSchema }, async (request, reply) => {
    const { email, password, name, locale, country } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 5/hour per IP
    if (isRateLimited(`signup:${clientIp}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many signup attempts. Please try again later.");
    }

    try {
      // Check if email already exists (exclude soft-deleted accounts)
      const existing = await db.prepare("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL").get(email.toLowerCase());
      if (existing) {
        return sendError(reply, 409, "EMAIL_EXISTS", "An account with this email already exists.");
      }

      // Prepare all values before transaction (async operations must happen outside)
      const userId = generateUserId();
      const now = new Date().toISOString();
      const passwordHash = await authService.hashPassword(password);
      const providerId = `ap_${crypto.randomBytes(8).toString("hex")}`;

      // Wrap all DB writes in a transaction for atomicity
      // If any step fails, all changes are rolled back (no orphaned records)
      await db.transaction(async () => {
        // Create user
        await db.prepare(
          `INSERT INTO users (id, email, display_name, locale, country, risk_level, created_at)
           VALUES (?, ?, ?, ?, ?, 'low', ?)`
        ).run(userId, email.toLowerCase(), name || null, locale || null, country || null, now);

        // Create entitlements
        await db.prepare(
          `INSERT INTO entitlements (user_id, tier, credits_balance, updated_at)
           VALUES (?, 'free', 0, ?)`
        ).run(userId, now);

        // Store password
        await db.prepare(
          `INSERT INTO user_credentials (user_id, password_hash, created_at)
           VALUES (?, ?, ?)`
        ).run(userId, passwordHash, now);

        // Create auth provider record
        await db.prepare(
          `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id)
           VALUES (?, ?, 'email', ?)`
        ).run(providerId, userId, email.toLowerCase());
      });

      // Create session and tokens
      await authService.createSession(userId, {
        deviceName: request.headers["user-agent"],
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
      });

      const accessToken = authService.generateAccessToken(userId);
      const { token: refreshToken } = await authService.createRefreshToken(userId);

      // Send verification email (don't await - fire and forget)
      if (emailService.isConfigured()) {
        authService.createEmailVerificationToken(userId).then(({ token }) => {
          emailService.sendVerificationEmail(email, token).catch((err) => {
            console.error("Failed to send verification email:", err.message);
          });
        });
      }

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: "signup" },
      });

      return reply.status(201).send({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900, // 15 minutes
      });
    } catch (error) {
      console.error("Signup error:", error);
      return sendError(reply, 500, "SIGNUP_FAILED", "Failed to create account. Please try again.");
    }
  });

  // ==================== LOGIN ====================

  app.post("/auth/login", { schema: loginSchema }, async (request, reply) => {
    const { email, password } = request.body;
    const clientIp = getClientIp(request);
    const normalizedEmail = email.toLowerCase();

    // Rate limit: 10/hour per IP
    if (isRateLimited(`login:${clientIp}`, 10, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many login attempts. Please try again later.");
    }

    try {
      // Find user (exclude soft-deleted accounts)
      const user = await db.prepare("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL").get(normalizedEmail);

      // Use constant-time verification even if user doesn't exist
      const credentials = user
        ? await db.prepare("SELECT password_hash FROM user_credentials WHERE user_id = ?").get(user.id)
        : null;

      // Always run bcrypt.compare to prevent timing attacks
      const dummyHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.IHhNFkDXgLqWKu";
      const isValid = await authService.verifyPassword(password, credentials?.password_hash || dummyHash);

      if (!user || !credentials || !isValid) {
        // Log failed attempt
        if (user) {
          await authService.incrementFailedLoginCount(user.id);
          await authService.logAuthEvent({
            userId: user.id,
            eventType: "login_failed",
            ipAddress: clientIp,
            metadata: { reason: "invalid_password" },
          });
        } else {
          await authService.logAuthEvent({
            eventType: "login_failed",
            ipAddress: clientIp,
            metadata: { email: normalizedEmail, reason: "user_not_found" },
          });
        }

        return sendError(reply, 401, "INVALID_CREDENTIALS", "Invalid email or password.");
      }

      // Check if account is locked
      const isLocked = await authService.isAccountLocked(user.id);
      if (isLocked) {
        return sendError(reply, 403, "ACCOUNT_LOCKED", "Account is temporarily locked. Please try again later.");
      }

      // Reset failed login count on success
      await authService.resetFailedLoginCount(user.id);

      // Create session and tokens
      await authService.createSession(user.id, {
        deviceName: request.headers["user-agent"],
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
      });

      const accessToken = authService.generateAccessToken(user.id);
      const { token: refreshToken } = await authService.createRefreshToken(user.id);

      // Log success
      await authService.logAuthEvent({
        userId: user.id,
        eventType: "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: "email" },
      });

      return reply.send({
        user_id: user.id,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900,
      });
    } catch (error) {
      console.error("Login error:", error);
      return sendError(reply, 500, "LOGIN_FAILED", "Login failed. Please try again.");
    }
  });

  // ==================== SOCIAL AUTH ====================

  app.post("/auth/social", { schema: socialAuthSchema }, async (request, reply) => {
    const { provider, id_token, name } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 20/hour per IP
    if (isRateLimited(`social:${clientIp}`, 20, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many authentication attempts. Please try again later.");
    }

    try {
      // Check if provider is supported and configured
      if (!isProviderConfigured(provider)) {
        return sendError(reply, 501, "PROVIDER_NOT_CONFIGURED", `${provider} authentication is not configured.`);
      }

      // Cryptographically verify the ID token with provider's public keys
      // This prevents authentication bypass via forged tokens
      let verifiedToken;
      try {
        verifiedToken = await verifySocialToken(provider, id_token);
      } catch (verifyError) {
        console.error(`[SocialAuth] Token verification failed for ${provider}:`, verifyError.message);

        // Provide user-friendly error messages
        if (verifyError.message.includes("expired")) {
          return sendError(reply, 401, "TOKEN_EXPIRED", "Sign-in session expired. Please try again.");
        }
        if (verifyError.message.includes("invalid signature") || verifyError.message.includes("INVALID_TOKEN")) {
          return sendError(reply, 401, "INVALID_TOKEN", "Invalid authentication token. Please try again.");
        }
        return sendError(reply, 401, "VERIFICATION_FAILED", "Could not verify authentication token.");
      }

      const providerUserId = verifiedToken.sub;
      const userEmail = verifiedToken.email; // Only populated if verified by provider
      const userName = verifiedToken.name || name || null; // Apple sends name separately on first auth

      if (!providerUserId) {
        return sendError(reply, 400, "INVALID_TOKEN", "Could not extract user ID from token.");
      }

      // Check if provider account is already linked
      const existingProvider = db
        .prepare("SELECT user_id FROM user_auth_providers WHERE provider = ? AND provider_user_id = ?")
        .get(provider, providerUserId);

      let userId;
      let isNewUser = false;

      if (existingProvider) {
        // Existing user, login
        userId = existingProvider.user_id;
      } else {
        // New user, create account
        isNewUser = true;
        userId = generateUserId();
        const now = new Date().toISOString();

        // Check if email already exists (link accounts, exclude soft-deleted)
        if (userEmail) {
          const existingUser = await db.prepare("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL").get(userEmail.toLowerCase());
          if (existingUser) {
            userId = existingUser.id;
            isNewUser = false;
          }
        }

        if (isNewUser) {
          await db.prepare(
            `INSERT INTO users (id, email, display_name, email_verified, risk_level, created_at)
             VALUES (?, ?, ?, 1, 'low', ?)`
          ).run(userId, userEmail?.toLowerCase() || null, userName, now);

          await db.prepare(
            `INSERT INTO entitlements (user_id, tier, credits_balance, updated_at)
             VALUES (?, 'free', 0, ?)`
          ).run(userId, now);
        }

        // Link provider
        const providerId = `ap_${crypto.randomBytes(8).toString("hex")}`;
        await db.prepare(
          `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, provider_data)
           VALUES (?, ?, ?, ?, ?)`
        ).run(providerId, userId, provider, providerUserId, JSON.stringify({ email: userEmail }));
      }

      // Create session and tokens
      await authService.createSession(userId, {
        deviceName: request.headers["user-agent"],
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
      });

      const accessToken = authService.generateAccessToken(userId);
      const { token: refreshToken } = await authService.createRefreshToken(userId);

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: isNewUser ? "login_success" : "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: provider, is_new_user: isNewUser },
      });

      return reply.status(isNewUser ? 201 : 200).send({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900,
        is_new_user: isNewUser,
      });
    } catch (error) {
      console.error("Social auth error:", error);
      return sendError(reply, 500, "SOCIAL_AUTH_FAILED", "Social authentication failed. Please try again.");
    }
  });

  // ==================== TOKEN REFRESH ====================

  app.post("/auth/refresh", { schema: refreshSchema }, async (request, reply) => {
    const { refresh_token } = request.body;

    try {
      // Verify and rotate the refresh token
      const result = await authService.rotateRefreshToken(refresh_token);

      // Generate new access token
      const accessToken = authService.generateAccessToken(result.userId);

      // Log token refresh
      await authService.logAuthEvent({
        userId: result.userId,
        eventType: "token_refresh",
        ipAddress: getClientIp(request),
      });

      return reply.send({
        access_token: accessToken,
        refresh_token: result.token,
        expires_in: 900,
      });
    } catch (error) {
      console.error("Token refresh error:", error.message);

      // Check if this was a reuse attack
      if (error.message.includes("reuse")) {
        await authService.logAuthEvent({
          eventType: "token_reuse_detected",
          ipAddress: getClientIp(request),
        });
        return sendError(reply, 401, "TOKEN_REUSE_DETECTED", "Token reuse detected. Please login again.");
      }

      return sendError(reply, 401, "INVALID_REFRESH_TOKEN", "Invalid or expired refresh token.");
    }
  });

  // ==================== LOGOUT ====================

  app.post("/auth/logout", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(reply, 401, "UNAUTHORIZED", "Missing authorization header.");
    }

    try {
      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);

      // Revoke all refresh tokens for user (security: prevents token reuse)
      authService.revokeAllRefreshTokensForUser(payload.sub);

      // Batch revoke all sessions (replaces N+1 query pattern)
      await db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").run(
        payload.sub
      );

      // Log logout
      await authService.logAuthEvent({
        userId: payload.sub,
        eventType: "logout",
        ipAddress: getClientIp(request),
      });

      return reply.send({ message: "Logged out successfully." });
    } catch (error) {
      // Even if token is invalid, return success (user wanted to logout anyway)
      return reply.send({ message: "Logged out successfully." });
    }
  });

  // ==================== FORGOT PASSWORD ====================

  app.post("/auth/forgot-password", { schema: forgotPasswordSchema }, async (request, reply) => {
    const { email } = request.body;
    const clientIp = getClientIp(request);
    const normalizedEmail = email.toLowerCase();

    // Rate limit: 3/hour per email
    if (isRateLimited(`forgot:${normalizedEmail}`, 3, 60 * 60 * 1000)) {
      // Still return 200 to prevent enumeration
      return reply.send({ message: "If an account exists, a reset email has been sent." });
    }

    try {
      // Find user (exclude soft-deleted accounts)
      const user = await db.prepare("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL").get(normalizedEmail);

      if (user && emailService.isConfigured()) {
        // Create reset token
        const { token, expiresAt } = await authService.createPasswordResetToken(user.id);

        // Send email
        await emailService.sendPasswordResetEmail(normalizedEmail, token, expiresAt);

        // Log event
        await authService.logAuthEvent({
          userId: user.id,
          eventType: "password_reset_requested",
          ipAddress: clientIp,
        });
      }

      // Always return same response to prevent enumeration
      return reply.send({ message: "If an account exists, a reset email has been sent." });
    } catch (error) {
      console.error("Forgot password error:", error);
      // Still return 200 to prevent enumeration
      return reply.send({ message: "If an account exists, a reset email has been sent." });
    }
  });

  // ==================== RESET PASSWORD ====================

  app.post("/auth/reset-password", { schema: resetPasswordSchema }, async (request, reply) => {
    const { token, new_password } = request.body;
    const clientIp = getClientIp(request);

    try {
      // Verify token
      const { userId, tokenId } = await authService.verifyPasswordResetToken(token);

      // Hash new password
      const passwordHash = await authService.hashPassword(new_password);

      // Update password
      await db.prepare("UPDATE user_credentials SET password_hash = ?, password_changed_at = datetime('now') WHERE user_id = ?").run(
        passwordHash,
        userId
      );

      // Mark token as used
      await authService.markPasswordResetTokenUsed(tokenId);

      // Invalidate all other reset tokens
      await authService.invalidateAllPasswordResetTokens(userId);

      // SECURITY: Revoke all refresh tokens and mark families as compromised
      // This forces re-authentication on all devices after password change
      authService.revokeAllRefreshTokensForUser(userId);
      authService.compromiseAllTokenFamiliesForUser(userId);

      // Batch revoke all sessions (replaces N+1 query pattern)
      await db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").run(
        userId
      );

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: "password_reset_completed",
        ipAddress: clientIp,
      });

      // Send security alert email
      if (emailService.isConfigured()) {
        const user = await db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
        if (user?.email) {
          emailService.sendSecurityAlertEmail(user.email, {
            alertType: "password_changed",
            timestamp: new Date(),
          }).catch((err) => console.error("Failed to send security alert:", err.message));
        }
      }

      return reply.send({ message: "Password reset successful. Please login with your new password." });
    } catch (error) {
      console.error("Reset password error:", error.message);
      return sendError(reply, 400, "INVALID_TOKEN", "Invalid or expired reset token.");
    }
  });

  // ==================== VERIFY EMAIL ====================

  app.post("/auth/verify-email", { schema: verifyEmailSchema }, async (request, reply) => {
    const { token } = request.body;

    try {
      const { userId, tokenId } = await authService.verifyEmailVerificationToken(token);

      // Mark email as verified
      await db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);

      // Mark token as used
      await authService.markEmailVerificationTokenUsed(tokenId);

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: "email_verified",
        ipAddress: getClientIp(request),
      });

      return reply.send({ message: "Email verified successfully." });
    } catch (error) {
      console.error("Email verification error:", error.message);
      return sendError(reply, 400, "INVALID_TOKEN", "Invalid or expired verification token.");
    }
  });

  // ==================== GET CURRENT USER ====================

  app.get("/auth/me", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(reply, 401, "UNAUTHORIZED", "Missing authorization header.");
    }

    try {
      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);

      const user = await db.prepare(
        `SELECT u.id, u.email, u.display_name, u.avatar_url, u.email_verified, u.created_at
         FROM users u WHERE u.id = ?`
      ).get(payload.sub);

      if (!user) {
        return sendError(reply, 404, "USER_NOT_FOUND", "User not found.");
      }

      // Get linked providers
      const providers = db
        .prepare("SELECT provider FROM user_auth_providers WHERE user_id = ?")
        .all(payload.sub)
        .map((p) => p.provider);

      return reply.send({
        user_id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        email_verified: Boolean(user.email_verified),
        providers,
        created_at: user.created_at,
      });
    } catch (error) {
      console.error("Get user error:", error.message);
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
  });

  // ==================== LIST SESSIONS ====================

  app.get("/auth/sessions", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(reply, 401, "UNAUTHORIZED", "Missing authorization header.");
    }

    try {
      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);

      const sessions = await authService.listSessions(payload.sub);

      return reply.send({
        sessions: sessions.map((s) => ({
          id: s.id,
          device_name: s.deviceName,
          ip_address: s.ipAddress,
          last_active_at: s.lastActiveAt,
          created_at: s.createdAt,
        })),
      });
    } catch (error) {
      console.error("List sessions error:", error.message);
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
  });

  // ==================== REVOKE SESSION ====================

  app.delete("/auth/sessions/:id", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(reply, 401, "UNAUTHORIZED", "Missing authorization header.");
    }

    try {
      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);
      const sessionId = request.params.id;

      // Verify session belongs to user
      const session = await db.prepare("SELECT user_id FROM user_sessions WHERE id = ?").get(sessionId);
      if (!session || session.user_id !== payload.sub) {
        return sendError(reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      }

      await authService.revokeSession(sessionId);

      return reply.send({ message: "Session revoked successfully." });
    } catch (error) {
      console.error("Revoke session error:", error.message);
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
  });

  // ==================== DELETE ACCOUNT (GDPR Article 17) ====================

  app.delete("/auth/delete-account", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(reply, 401, "UNAUTHORIZED", "Authentication required.");
    }

    let userId;
    try {
      const decoded = authService.verifyAccessToken(authHeader.substring(7));
      userId = decoded.sub;
    } catch {
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired token.");
    }

    const clientIp = getClientIp(request);

    // Rate limit: 1 per hour per user (prevent abuse)
    if (isRateLimited(`delete-account:${userId}`, 1, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Please wait before retrying account deletion.");
    }

    try {
      // Perform cascading deletion
      await authService.deleteUserAccount(userId);

      // Log GDPR compliance event
      await gdprAuditService.logAccountDeletion(userId, clientIp);

      // Return 204 No Content on success
      return reply.code(204).send();
    } catch (error) {
      console.error("[DeleteAccount] Failed:", error);

      if (error.message === "User not found") {
        return sendError(reply, 404, "USER_NOT_FOUND", "Account not found.");
      }

      return sendError(reply, 500, "DELETION_FAILED", "Account deletion failed. Please contact support.");
    }
  });
}

module.exports = { registerAuthRoutes, clearRateLimits };
