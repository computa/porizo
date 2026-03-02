/**
 * Authentication Routes
 *
 * Handles user signup, login, social auth, token refresh,
 * password reset, and email verification.
 */

const authService = require("../services/auth-service");
const emailService = require("../services/email-service");
const smsService = require("../services/sms-service");
const gdprAuditService = require("../services/gdpr-audit-service");
const {
  verifySocialToken,
  verifyFacebookToken,
  exchangeGoogleAuthorizationCode,
  exchangeFacebookAuthorizationCode,
  isProviderConfigured,
} = require("../services/social-token-verifier");
const { exchangeAppleAuthorizationCode } = require("../services/apple-signin");
const crypto = require("crypto");

// Rate limit tracking (in-memory for now, Redis in production)
const rateLimits = new Map();

// Phone registration tokens (in-memory, 15-min expiry)
// Key: token, Value: { phone_number, verified_at, expires_at }
const registrationTokens = new Map();

/**
 * Clear all rate limits (for testing only)
 */
function clearRateLimits() {
  rateLimits.clear();
}

/**
 * Clear all registration tokens (for testing only)
 */
function clearRegistrationTokens() {
  registrationTokens.clear();
}

/**
 * Generate a registration token for phone auth
 * @param {string} phoneNumber - Verified phone number
 * @returns {string} Registration token
 */
function createRegistrationToken(phoneNumber) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  registrationTokens.set(token, {
    phone_number: phoneNumber,
    verified_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  return token;
}

/**
 * Verify and consume a registration token
 * @param {string} token - Registration token
 * @returns {{ valid: boolean, phone_number?: string }}
 */
function consumeRegistrationToken(token) {
  const data = registrationTokens.get(token);

  if (!data) {
    return { valid: false };
  }

  // Check expiration
  if (new Date(data.expires_at) < new Date()) {
    registrationTokens.delete(token);
    return { valid: false };
  }

  // Consume token (one-time use)
  registrationTokens.delete(token);

  return { valid: true, phone_number: data.phone_number };
}

/**
 * Validate E.164 phone number format
 * @param {string} phoneNumber
 * @returns {boolean}
 */
function isValidE164(phoneNumber) {
  // E.164: + followed by 1-15 digits
  return /^\+[1-9]\d{1,14}$/.test(phoneNumber);
}

/**
 * Validate username format
 * Rules: 3-20 chars, alphanumeric + underscore, starts with letter
 * @param {string} username
 * @returns {boolean}
 */
function isValidUsername(username) {
  return /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(username);
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
 * Create session and generate tokens for a user
 * @param {string} userId - User ID
 * @param {object} request - Fastify request object
 * @param {string} clientIp - Client IP address
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
async function createSessionAndTokens(userId, request, clientIp) {
  await authService.createSession(userId, {
    deviceName: request.headers["user-agent"],
    ipAddress: clientIp,
    userAgent: request.headers["user-agent"],
  });

  const accessToken = authService.generateAccessToken(userId);
  const { token: refreshToken } = await authService.createRefreshToken(userId);

  return { accessToken, refreshToken };
}

/**
 * Pre-handler hook to require authentication
 * Sets request.userId if valid, returns 401 error if not
 */
async function requireAuth(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(reply, 401, "UNAUTHORIZED", "Missing authorization header.");
  }
  try {
    const payload = authService.verifyAccessToken(authHeader.substring(7));
    request.userId = payload.sub;
  } catch {
    return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
  }
}

/**
 * Register auth routes on Fastify app
 */
function registerAuthRoutes(app, { db, subscriptionManager }) {
  // Initialize services with database
  authService.initialize(db);
  gdprAuditService.initialize(db);
  smsService.initialize(db);

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
      required: ["provider"],
      properties: {
        provider: { type: "string", enum: ["apple", "google", "facebook"] },
        id_token: { type: "string" },
        access_token: { type: "string" },
        name: { type: "string", maxLength: 100 },
        nonce: { type: "string", minLength: 8, maxLength: 256 },
        provider_user_id: { type: "string", maxLength: 255 },
        authorization_code: { type: "string", maxLength: 2048 },
        code_verifier: { type: "string", maxLength: 256 },
        redirect_uri: { type: "string", maxLength: 512 },
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

  const phoneSendCodeSchema = {
    body: {
      type: "object",
      required: ["phone_number"],
      properties: {
        phone_number: { type: "string", pattern: "^\\+[1-9]\\d{1,14}$" },
      },
    },
  };

  const phoneVerifySchema = {
    body: {
      type: "object",
      required: ["phone_number", "code"],
      properties: {
        phone_number: { type: "string", pattern: "^\\+[1-9]\\d{1,14}$" },
        code: { type: "string", minLength: 6, maxLength: 6 },
      },
    },
  };

  const phoneRegisterSchema = {
    body: {
      type: "object",
      required: ["registration_token", "username"],
      properties: {
        registration_token: { type: "string", minLength: 64, maxLength: 64 },
        username: { type: "string", minLength: 3, maxLength: 20 },
        name: { type: "string", maxLength: 100 },
      },
    },
  };

  const usernameAvailableSchema = {
    querystring: {
      type: "object",
      required: ["username"],
      properties: {
        username: { type: "string", minLength: 3, maxLength: 20 },
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

        // Create entitlements (centralized — reads feature flags + inserts 9-column row)
        await subscriptionManager.createFreeEntitlements(userId, { now });

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
      const { accessToken, refreshToken } = await createSessionAndTokens(userId, request, clientIp);

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
        expires_in: 3600, // 60 minutes
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
      const { accessToken, refreshToken } = await createSessionAndTokens(user.id, request, clientIp);

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
        expires_in: 3600,
      });
    } catch (error) {
      console.error("Login error:", error);
      return sendError(reply, 500, "LOGIN_FAILED", "Login failed. Please try again.");
    }
  });

  // ==================== SOCIAL AUTH ====================

  app.post("/auth/social", { schema: socialAuthSchema }, async (request, reply) => {
    const {
      provider,
      id_token,
      access_token,
      name,
      nonce,
      authorization_code,
      code_verifier,
      redirect_uri,
    } = request.body;
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

      const hasIdToken = typeof id_token === "string" && id_token.trim();
      const hasAccessToken = typeof access_token === "string" && access_token.trim();
      const hasAuthCode = typeof authorization_code === "string" && authorization_code.trim();

      if (provider === "apple" && (!nonce || !String(nonce).trim())) {
        return sendError(reply, 400, "NONCE_REQUIRED", "Apple Sign-In requires a nonce. Please try again.");
      }

      if (provider === "apple" && !hasIdToken) {
        return sendError(reply, 400, "TOKEN_REQUIRED", "Apple Sign-In requires an ID token.");
      }

      if (provider === "google" && !hasIdToken && !hasAuthCode) {
        return sendError(reply, 400, "TOKEN_REQUIRED", "Google Sign-In requires an ID token or authorization code.");
      }

      if (provider === "facebook" && !hasAccessToken && !hasAuthCode) {
        return sendError(reply, 400, "TOKEN_REQUIRED", "Facebook Sign-In requires an access token or authorization code.");
      }

      let resolvedIdToken = hasIdToken ? id_token : null;
      let resolvedAccessToken = hasAccessToken ? access_token : null;

      if (provider === "google" && !resolvedIdToken && hasAuthCode) {
        try {
          const exchange = await exchangeGoogleAuthorizationCode(authorization_code, {
            codeVerifier: code_verifier,
            redirectUri: redirect_uri,
          });
          resolvedIdToken = exchange.id_token;
        } catch (exchangeError) {
          console.error("[SocialAuth] Google code exchange failed:", exchangeError.message);
          return sendError(reply, 401, "TOKEN_EXCHANGE_FAILED", "Google authorization code exchange failed.");
        }
      }

      if (provider === "google" && !resolvedIdToken) {
        return sendError(reply, 400, "TOKEN_REQUIRED", "Google Sign-In requires an ID token.");
      }

      if (provider === "facebook" && !resolvedAccessToken && hasAuthCode) {
        try {
          const exchange = await exchangeFacebookAuthorizationCode(authorization_code, {
            redirectUri: redirect_uri,
          });
          resolvedAccessToken = exchange.access_token;
        } catch (exchangeError) {
          console.error("[SocialAuth] Facebook code exchange failed:", exchangeError.message);
          return sendError(reply, 401, "TOKEN_EXCHANGE_FAILED", "Facebook authorization code exchange failed.");
        }
      }

      if (provider === "facebook" && !resolvedAccessToken) {
        return sendError(reply, 400, "TOKEN_REQUIRED", "Facebook Sign-In requires an access token.");
      }

      let verifiedToken;
      try {
        if (provider === "facebook") {
          verifiedToken = await verifyFacebookToken(resolvedAccessToken);
        } else {
          verifiedToken = await verifySocialToken(provider, resolvedIdToken, {
            rawNonce: provider === "apple" ? nonce : undefined,
          });
        }
      } catch (verifyError) {
        console.error(`[SocialAuth] Token verification failed for ${provider}:`, verifyError.message);

        const socialAuthErrorMap = {
          APPLE_CLIENT_ID_NOT_CONFIGURED: [501, "PROVIDER_NOT_CONFIGURED", "Apple authentication is not configured."],
          GOOGLE_CLIENT_ID: [501, "PROVIDER_NOT_CONFIGURED", "Google authentication is not configured."],
          FACEBOOK_APP_NOT_CONFIGURED: [501, "PROVIDER_NOT_CONFIGURED", "Facebook authentication is not configured."],
          NONCE_REQUIRED: [400, "NONCE_REQUIRED", "Apple Sign-In requires a nonce. Please try again."],
          INVALID_NONCE: [401, "INVALID_NONCE", "Sign-in session invalid. Please try again."],
          INVALID_TOKEN_FORMAT: [400, "INVALID_TOKEN", "Invalid authentication token format."],
          INVALID_FACEBOOK_TOKEN: [401, "INVALID_TOKEN", "Invalid authentication token. Please try again."],
          expired: [401, "TOKEN_EXPIRED", "Sign-in session expired. Please try again."],
          "invalid signature": [401, "INVALID_TOKEN", "Invalid authentication token. Please try again."],
          INVALID_TOKEN: [401, "INVALID_TOKEN", "Invalid authentication token. Please try again."],
        };

        for (const [pattern, [status, code, message]] of Object.entries(socialAuthErrorMap)) {
          if (verifyError.message.includes(pattern)) {
            return sendError(reply, status, code, message);
          }
        }
        return sendError(reply, 401, "VERIFICATION_FAILED", "Could not verify authentication token.");
      }

      const providerUserId = verifiedToken.sub;
      const userEmail = verifiedToken.email; // Only populated if verified by provider
      const userName = verifiedToken.name || name || null; // Apple sends name separately on first auth

      // Optional: exchange Apple authorization code for refresh token (server-side validation capability)
      let appleRefreshToken = null;
      if (provider === "apple" && authorization_code) {
        try {
          const exchange = await exchangeAppleAuthorizationCode(authorization_code);
          appleRefreshToken = exchange.refresh_token || null;
        } catch (exchangeError) {
          console.warn("[SocialAuth] Apple auth code exchange failed:", exchangeError.message);
        }
      }

      if (!providerUserId) {
        return sendError(reply, 400, "INVALID_TOKEN", "Could not extract user ID from token.");
      }

      // Check if provider account is already linked
      const existingProvider = await db
        .prepare("SELECT user_id FROM user_auth_providers WHERE provider = ? AND provider_user_id = ?")
        .get(provider, providerUserId);

      let userId;
      let isNewUser = false;

      if (existingProvider) {
        // Existing user, login
        userId = existingProvider.user_id;
        const existingUser = await db.prepare("SELECT id, deleted_at FROM users WHERE id = ?").get(userId);
        if (!existingUser || existingUser.deleted_at) {
          // Orphaned provider mapping or deleted user - create fresh account
          // Use transaction to prevent race conditions with concurrent OAuth requests
          const originalUserId = userId;
          const recoveryReason = existingUser ? "deleted_user" : "orphaned_mapping";
          const now = new Date().toISOString();
          userId = generateUserId();
          isNewUser = true;

          await db.transaction(async () => {
            await db.prepare(
              `INSERT INTO users (id, email, display_name, email_verified, risk_level, created_at)
               VALUES (?, ?, ?, 1, 'low', ?)`
            ).run(userId, userEmail?.toLowerCase() || null, userName, now);

            await subscriptionManager.createFreeEntitlements(userId, { now });

            await db.prepare(
              `UPDATE user_auth_providers SET user_id = ? WHERE provider = ? AND provider_user_id = ?`
            ).run(userId, provider, providerUserId);
          });

          // Audit log for compliance - orphaned user recovery is security-sensitive
          await authService.logAuthEvent({
            userId,
            // Use an allowed event type to satisfy the auth_events constraint.
            // Preserve the recovery details in metadata for auditability.
            eventType: "login_success",
            ipAddress: clientIp,
            userAgent: request.headers["user-agent"],
            metadata: {
              method: provider,
              event_subtype: "orphaned_provider_recovery",
              providerUserId,
              originalUserId,
              reason: recoveryReason,
            },
          });
        }
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

          await subscriptionManager.createFreeEntitlements(userId, { now });
        }

        // Link provider
        const providerId = `ap_${crypto.randomBytes(8).toString("hex")}`;
        const providerData = {
          email: userEmail,
          ...(appleRefreshToken ? { apple_refresh_token: appleRefreshToken, apple_refresh_obtained_at: now } : {}),
        };
        await db.prepare(
          `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, provider_data)
           VALUES (?, ?, ?, ?, ?)`
        ).run(providerId, userId, provider, providerUserId, JSON.stringify(providerData));
      }

      // If provider already linked and we have a new Apple refresh token, update provider_data
      if (provider === "apple" && appleRefreshToken && existingProvider) {
        const current = await db
          .prepare("SELECT provider_data FROM user_auth_providers WHERE provider = ? AND provider_user_id = ?")
          .get(provider, providerUserId);
        let providerData = {};
        if (current?.provider_data) {
          try {
            providerData = JSON.parse(current.provider_data);
          } catch {
            providerData = {};
          }
        }
        providerData.apple_refresh_token = appleRefreshToken;
        providerData.apple_refresh_obtained_at = new Date().toISOString();
        await db
          .prepare("UPDATE user_auth_providers SET provider_data = ? WHERE provider = ? AND provider_user_id = ?")
          .run(JSON.stringify(providerData), provider, providerUserId);
      }

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(userId, request, clientIp);

      // Log event
      await authService.logAuthEvent({
        userId,
        // The auth_events constraint does not include signup_success; capture the
        // distinction in metadata while using an allowed event type.
        eventType: "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: provider, is_new_user: isNewUser },
      });

      return reply.status(isNewUser ? 201 : 200).send({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
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
      if (!result.userId) {
        request.log.error({ resultKeys: Object.keys(result || {}) }, "Refresh rotation missing userId");
        return sendError(reply, 401, "INVALID_REFRESH_TOKEN", "Invalid or expired refresh token.");
      }
      const user = await db.prepare("SELECT id, deleted_at FROM users WHERE id = ?").get(result.userId);
      if (!user || user.deleted_at) {
        request.log.error(
          {
            userId: result.userId,
            userExists: Boolean(user),
            userDeleted: Boolean(user?.deleted_at),
          },
          "Refresh token resolved to missing/deleted user"
        );
        await db.prepare("UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL")
          .run(result.userId);
        await db.prepare("UPDATE token_families SET compromised_at = CURRENT_TIMESTAMP WHERE user_id = ? AND compromised_at IS NULL")
          .run(result.userId);
        return sendError(reply, 401, "INVALID_REFRESH_TOKEN", "Invalid or expired refresh token.");
      }

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
        expires_in: 3600,
      });
    } catch (error) {
      console.error("Token refresh error:", error.message);

      // Check error codes from auth-service for specific handling
      if (error.code === "TOKEN_REUSE_DETECTED") {
        await authService.logAuthEvent({
          eventType: "token_reuse_detected",
          ipAddress: getClientIp(request),
        });
        return sendError(reply, 401, "TOKEN_REUSE_DETECTED", "Token reuse detected. Please login again.");
      }

      if (error.code === "TOKEN_ALREADY_ROTATED") {
        // Grace period scenario - app killed during refresh. Recoverable via re-auth.
        return sendError(reply, 401, "TOKEN_ALREADY_ROTATED", "Session expired. Please sign in again.");
      }

      if (error.code === "TOKEN_FAMILY_COMPROMISED") {
        return sendError(reply, 401, "TOKEN_FAMILY_COMPROMISED", "Session invalidated. Please login again.");
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
      await db.prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL").run(
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
      // Logout always succeeds from user perspective, but log for debugging
      request.log.warn({ error: error.message }, "Logout processing failed");
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
      await db.prepare("UPDATE user_credentials SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(
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
      await db.prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL").run(
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

  // ==================== USER PROFILE HELPERS ====================

  async function buildUserProfileResponse(userId) {
    const user = await db.prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.email_verified,
                u.phone_number, u.username, u.created_at
         FROM users u
         WHERE u.id = ?
           AND u.deleted_at IS NULL`
    ).get(userId);

    if (!user) return null;

    const providerRows = await db
      .prepare("SELECT provider FROM user_auth_providers WHERE user_id = ?")
      .all(userId);
    const providers = providerRows.map((p) => p.provider);

    const isRelayEmail = user.email && user.email.endsWith("@privaterelay.appleid.com");
    const needsProfileCompletion = (!user.email || isRelayEmail) && !user.phone_number;

    return {
      user_id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      email_verified: Boolean(user.email_verified),
      providers,
      created_at: user.created_at,
      phone_number: user.phone_number || null,
      username: user.username || null,
      needs_profile_completion: needsProfileCompletion,
    };
  }

  // ==================== GET CURRENT USER ====================

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const profile = await buildUserProfileResponse(request.userId);
    if (!profile) {
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
    return reply.send(profile);
  });

  // ==================== UPDATE PROFILE ====================

  app.patch("/auth/profile", { preHandler: requireAuth }, async (request, reply) => {
    const { contact_email, phone_number, display_name } = request.body || {};

    if (!contact_email && !phone_number && !display_name) {
      return sendError(reply, 400, "MISSING_FIELDS", "At least one field (contact_email, phone_number, display_name) is required.");
    }

    // Validate email format if provided
    if (contact_email != null) {
      const emailStr = String(contact_email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
        return sendError(reply, 400, "INVALID_EMAIL", "Please provide a valid email address.");
      }
      // Check uniqueness
      const existing = await db.prepare(
        "SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL"
      ).get(emailStr, request.userId);
      if (existing) {
        return sendError(reply, 409, "EMAIL_EXISTS", "This email is already associated with another account.");
      }
    }

    // Validate E.164 phone format if provided
    if (phone_number != null) {
      if (!/^\+[1-9]\d{1,14}$/.test(String(phone_number))) {
        return sendError(reply, 400, "INVALID_PHONE", "Phone number must be in E.164 format (e.g., +14155551234).");
      }
      // Check uniqueness
      const existingPhone = await db.prepare(
        "SELECT id FROM users WHERE phone_number = ? AND id != ? AND deleted_at IS NULL"
      ).get(String(phone_number), request.userId);
      if (existingPhone) {
        return sendError(reply, 409, "PHONE_EXISTS", "This phone number is already associated with another account.");
      }
    }

    // Build dynamic UPDATE
    const setClauses = [];
    const values = [];

    if (contact_email != null) {
      setClauses.push("email = ?");
      values.push(String(contact_email).trim().toLowerCase());
    }
    if (phone_number != null) {
      setClauses.push("phone_number = ?");
      values.push(String(phone_number));
    }
    if (display_name != null) {
      const trimmedName = String(display_name).trim();
      if (trimmedName.length > 100) {
        return sendError(reply, 400, "INVALID_DISPLAY_NAME", "Display name must be 100 characters or fewer.");
      }
      setClauses.push("display_name = ?");
      values.push(trimmedName);
    }

    values.push(request.userId);

    await db.prepare(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`
    ).run(...values);

    const profile = await buildUserProfileResponse(request.userId);
    return reply.send(profile);
  });

  // ==================== LIST SESSIONS ====================

  app.get("/auth/sessions", { preHandler: requireAuth }, async (request, reply) => {
    const sessions = await authService.listSessions(request.userId);

    return reply.send({
      sessions: sessions.map((s) => ({
        id: s.id,
        device_name: s.deviceName,
        ip_address: s.ipAddress,
        last_active_at: s.lastActiveAt,
        created_at: s.createdAt,
      })),
    });
  });

  // ==================== REVOKE SESSION ====================

  app.delete("/auth/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const sessionId = request.params.id;

    // Verify session belongs to user
    const session = await db.prepare("SELECT user_id FROM user_sessions WHERE id = ?").get(sessionId);
    if (!session || session.user_id !== request.userId) {
      return sendError(reply, 404, "SESSION_NOT_FOUND", "Session not found.");
    }

    await authService.revokeSession(sessionId);

    return reply.send({ message: "Session revoked successfully." });
  });

  // ==================== PHONE AUTH: SEND CODE ====================

  app.post("/auth/phone/send-code", { schema: phoneSendCodeSchema }, async (request, reply) => {
    const { phone_number } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 5/hour per IP
    if (isRateLimited(`phone-send:${clientIp}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many verification requests. Please try again later.");
    }

    // Validate E.164 format
    if (!isValidE164(phone_number)) {
      return sendError(reply, 400, "E111_INVALID_PHONE", "Invalid phone number format. Use E.164 format (e.g., +12025551234).");
    }

    try {
      // Check if SMS service is configured
      if (!smsService.isConfigured()) {
        return sendError(reply, 503, "E112_SMS_NOT_CONFIGURED", "SMS verification is not available.");
      }

      // Send verification code via SMS service
      const result = await smsService.sendVerificationCode(phone_number);

      if (!result.success) {
        // Handle rate limit from SMS service
        if (result.retryAfterSeconds) {
          reply.header("Retry-After", result.retryAfterSeconds);
          return sendError(reply, 429, "E110_RATE_LIMITED", result.error || "Too many verification attempts.");
        }
        return sendError(reply, 400, "E113_SMS_FAILED", result.error || "Failed to send verification code.");
      }

      return reply.send({
        success: true,
        expires_at: result.expiresAt,
        masked_phone: result.maskedPhone,
      });
    } catch (error) {
      console.error("Phone send code error:", error);
      return sendError(reply, 500, "E119_PHONE_ERROR", "Failed to send verification code. Please try again.");
    }
  });

  // ==================== PHONE AUTH: VERIFY CODE ====================

  app.post("/auth/phone/verify", { schema: phoneVerifySchema }, async (request, reply) => {
    const { phone_number, code } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 10/hour per IP
    if (isRateLimited(`phone-verify:${clientIp}`, 10, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many verification attempts. Please try again later.");
    }

    // Validate E.164 format
    if (!isValidE164(phone_number)) {
      return sendError(reply, 400, "E111_INVALID_PHONE", "Invalid phone number format.");
    }

    try {
      // Verify code via SMS service
      const result = await smsService.verifyCode(phone_number, code);

      if (result.verified) {
        // Check if phone is already registered
        const existingUser = await db
          .prepare("SELECT id FROM users WHERE phone_number = ? AND deleted_at IS NULL")
          .get(phone_number);

        if (existingUser) {
          // Phone already registered - login instead
          const { accessToken, refreshToken } = await createSessionAndTokens(existingUser.id, request, clientIp);

          await authService.logAuthEvent({
            userId: existingUser.id,
            eventType: "login_success",
            ipAddress: clientIp,
            userAgent: request.headers["user-agent"],
            metadata: { method: "phone" },
          });

          return reply.send({
            success: true,
            verified: true,
            existing_user: true,
            user_id: existingUser.id,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600,
          });
        }

        // New phone - create registration token for signup
        const registrationToken = createRegistrationToken(phone_number);

        return reply.send({
          success: true,
          verified: true,
          existing_user: false,
          registration_token: registrationToken,
        });
      }

      // Verification failed
      return reply.send({
        success: true,
        verified: false,
        remaining_attempts: result.remainingAttempts,
        error: result.error,
      });
    } catch (error) {
      console.error("Phone verify error:", error);
      return sendError(reply, 500, "E119_PHONE_ERROR", "Verification failed. Please try again.");
    }
  });

  // ==================== PHONE AUTH: REGISTER ====================

  app.post("/auth/phone/register", { schema: phoneRegisterSchema }, async (request, reply) => {
    const { registration_token, username, name } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 5/hour per IP (same as signup)
    if (isRateLimited(`phone-register:${clientIp}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many registration attempts. Please try again later.");
    }

    try {
      // Validate registration token
      const tokenResult = consumeRegistrationToken(registration_token);
      if (!tokenResult.valid) {
        return sendError(reply, 400, "E114_INVALID_TOKEN", "Invalid or expired registration token. Please verify your phone again.");
      }

      const phoneNumber = tokenResult.phone_number;

      // Validate username format
      if (!isValidUsername(username)) {
        return sendError(reply, 400, "E115_INVALID_USERNAME", "Username must be 3-20 characters, start with a letter, and contain only letters, numbers, and underscores.");
      }

      // Check username availability
      const existingUsername = await db
        .prepare("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL")
        .get(username.toLowerCase());

      if (existingUsername) {
        return sendError(reply, 409, "E116_USERNAME_TAKEN", "This username is already taken.");
      }

      // Check if phone was taken in the meantime (race condition protection)
      const existingPhone = await db
        .prepare("SELECT id FROM users WHERE phone_number = ? AND deleted_at IS NULL")
        .get(phoneNumber);

      if (existingPhone) {
        return sendError(reply, 409, "E117_PHONE_EXISTS", "An account with this phone number already exists.");
      }

      // Create user
      const userId = generateUserId();
      const now = new Date().toISOString();

      await db.transaction(async () => {
        // Create user with phone (phone_number serves as the auth identifier)
        await db.prepare(
          `INSERT INTO users (id, username, display_name, phone_number, phone_verified_at, risk_level, created_at)
           VALUES (?, ?, ?, ?, ?, 'low', ?)`
        ).run(userId, username.toLowerCase(), name || null, phoneNumber, now, now);

        await subscriptionManager.createFreeEntitlements(userId, { now });
      });

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(userId, request, clientIp);

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: "phone_signup" },
      });

      return reply.status(201).send({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
      });
    } catch (error) {
      console.error("Phone register error:", error);
      return sendError(reply, 500, "E119_PHONE_ERROR", "Registration failed. Please try again.");
    }
  });

  // ==================== USERNAME AVAILABILITY ====================

  app.get("/users/username/available", { schema: usernameAvailableSchema }, async (request, reply) => {
    const { username } = request.query;

    // Validate username format first
    if (!isValidUsername(username)) {
      return reply.send({
        available: false,
        error: "Username must be 3-20 characters, start with a letter, and contain only letters, numbers, and underscores.",
      });
    }

    try {
      const normalizedUsername = username.toLowerCase();

      // Check if username exists
      const existing = await db
        .prepare("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL")
        .get(normalizedUsername);

      if (existing) {
        // Generate suggestions
        const suggestions = [];
        const base = normalizedUsername.slice(0, 15); // Leave room for suffix

        for (let i = 0; i < 3; i++) {
          const suffix = crypto.randomBytes(2).toString("hex").slice(0, 3);
          const suggestion = `${base}_${suffix}`;
          if (isValidUsername(suggestion)) {
            const suggestionExists = await db
              .prepare("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL")
              .get(suggestion);
            if (!suggestionExists) {
              suggestions.push(suggestion);
            }
          }
        }

        return reply.send({
          available: false,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
        });
      }

      return reply.send({
        available: true,
      });
    } catch (error) {
      console.error("Username availability check error:", error);
      return sendError(reply, 500, "E118_CHECK_FAILED", "Failed to check username availability.");
    }
  });

  // ==================== DELETE ACCOUNT (GDPR Article 17) ====================

  app.delete("/auth/delete-account", { preHandler: requireAuth }, async (request, reply) => {
    const clientIp = getClientIp(request);

    // Rate limit: 1 per hour per user (prevent abuse)
    if (isRateLimited(`delete-account:${request.userId}`, 1, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Please wait before retrying account deletion.");
    }

    try {
      // Perform cascading deletion
      await authService.deleteUserAccount(request.userId);

      // Log GDPR compliance event
      await gdprAuditService.logAccountDeletion(request.userId, clientIp);

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

module.exports = { registerAuthRoutes, clearRateLimits, clearRegistrationTokens };
