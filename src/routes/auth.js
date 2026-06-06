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
const identityService = require("../services/identity-service");
const { AttributionService } = require("../services/attribution-service");
const geoip = require("geoip-lite");
const {
  verifySocialToken,
  verifyFacebookToken,
  exchangeGoogleAuthorizationCode,
  exchangeFacebookAuthorizationCode,
  isProviderConfigured,
} = require("../services/social-token-verifier");
const { exchangeAppleAuthorizationCode } = require("../services/apple-signin");
const crypto = require("crypto");

// In-memory rate limit cache — first-pass check to avoid DB round-trip on every request.
// The authoritative rate limit state is in the DB (rate_limits table), which survives
// restarts and is shared across instances. The in-memory Map is a performance optimization only.
const rateLimits = new Map();
let authRouteDb = null;

// HMAC key for hashing phone numbers in registration tokens (derived from JWT_SECRET)
const PHONE_HMAC_KEY = process.env.JWT_SECRET || (process.env.NODE_ENV === "test" ? "test-secret-key-32chars-minimum!!" : (() => { throw new Error("JWT_SECRET required for phone HMAC"); })());

/**
 * Clear all rate limits (for testing only)
 * Clears both in-memory cache and DB entries for auth-keyed rate limits.
 */
async function clearRateLimits(db) {
  rateLimits.clear();
  if (db) {
    try {
      await db.prepare("DELETE FROM rate_limits WHERE action_type LIKE 'auth:%'").run();
    } catch { /* DB may not have the table in some test setups */ }
  }
}

/**
 * Clear all registration tokens (for testing only)
 */
async function clearRegistrationTokens(db) {
  if (db) {
    await db.prepare("DELETE FROM phone_registration_tokens").run();
  }
}

/**
 * Hash a phone number for storage (HMAC-SHA256, not reversible)
 */
function hashPhoneNumber(phoneNumber) {
  return crypto.createHmac("sha256", PHONE_HMAC_KEY).update(phoneNumber).digest("hex");
}

/**
 * Generate a DB-backed registration token for phone auth
 * @param {object} db - Database instance
 * @param {string} phoneNumber - Verified phone number
 * @param {string} ipAddress - Client IP address
 * @returns {Promise<string>} Registration token
 */
async function createRegistrationToken(db, phoneNumber, ipAddress) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const phoneHash = hashPhoneNumber(phoneNumber);
  // Use space-separated format for SQLite compatibility (CURRENT_TIMESTAMP comparison)
  const toDbTimestamp = (d) => d.toISOString().replace("T", " ").replace("Z", "");
  const now = toDbTimestamp(new Date());
  const expiresAt = toDbTimestamp(new Date(Date.now() + 15 * 60 * 1000));

  await db.prepare(
    `INSERT INTO phone_registration_tokens (token_hash, phone_number_hash, ip_address, verified_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHash, phoneHash, ipAddress || null, now, expiresAt);

  return token;
}

/**
 * Verify and consume a DB-backed registration token
 * @param {object} db - Database instance
 * @param {string} token - Registration token
 * @param {string} phoneNumber - Phone number to verify against
 * @returns {Promise<{ valid: boolean, phone_number?: string }>}
 */
async function consumeRegistrationToken(db, token, phoneNumber, ipAddress) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expectedHash = hashPhoneNumber(phoneNumber);

  // Atomic consume: UPDATE only if unconsumed, unexpired, phone matches, and IP matches.
  // The ip_address IS NULL fallback handles tokens created before IP-binding was added.
  // Returns the updated row count — if 0, token was already consumed or invalid.
  const result = await db.prepare(
    `UPDATE phone_registration_tokens
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE token_hash = ?
       AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
       AND phone_number_hash = ?
       AND (ip_address = ? OR ip_address IS NULL)`
  ).run(tokenHash, expectedHash, ipAddress || null);

  // result.changes (PG adapter) or result (SQLite) indicates rows affected
  const rowsAffected = result?.changes ?? result?.rowCount ?? 0;

  if (rowsAffected === 0) {
    return { valid: false };
  }

  return { valid: true, phone_number: phoneNumber };
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
 * Cross-identifier account lookup.
 * Checks email, phone, and social provider to find if any identifier
 * is already associated with an existing account.
 * Used by all registration paths to prevent duplicate accounts.
 *
 * @param {object} db - Database instance
 * @param {{ email?: string, phone?: string, providerType?: string, providerUserId?: string }} identifiers
 * @returns {Promise<{ exists: boolean, userId?: string, authMethods?: string[], maskedEmail?: string, maskedPhone?: string }>}
 */
async function findExistingAccountByIdentifiers(db, { email, phone, providerType, providerUserId } = {}) {
  let matchedUserId = null;
  let matchedVia = null;

  // Check email → user_contacts (verified only)
  if (email) {
    const row = await db.prepare(
      `SELECT uc.user_id as id FROM user_contacts uc
       JOIN users u ON u.id = uc.user_id AND u.deleted_at IS NULL
       WHERE uc.type = 'email' AND uc.value_normalized = ? AND uc.verified_at IS NOT NULL
       LIMIT 1`
    ).get(email.toLowerCase());
    if (row) {
      matchedUserId = row.id;
      matchedVia = "email";
    }
  }

  // Check phone → user_auth_providers
  if (!matchedUserId && phone) {
    const row = await db.prepare(
      `SELECT uap.user_id as id FROM user_auth_providers uap
       JOIN users u ON u.id = uap.user_id AND u.deleted_at IS NULL
       WHERE uap.provider = 'phone' AND uap.provider_user_id = ? AND uap.status = 'active'
       LIMIT 1`
    ).get(phone);
    if (row) {
      matchedUserId = row.id;
      matchedVia = "phone";
    }
  }

  // Check social provider → user_auth_providers
  if (!matchedUserId && providerType && providerUserId) {
    const row = await db.prepare(
      `SELECT uap.user_id FROM user_auth_providers uap
       JOIN users u ON u.id = uap.user_id AND u.deleted_at IS NULL
       WHERE uap.provider = ? AND uap.provider_user_id = ?`
    ).get(providerType, providerUserId);
    if (row) {
      matchedUserId = row.user_id;
      matchedVia = "social";
    }
  }

  if (!matchedUserId) {
    return { exists: false };
  }

  // Fetch auth methods and profile info for the matched account
  const providerRows = await db.prepare(
    "SELECT provider FROM user_auth_providers WHERE user_id = ?"
  ).all(matchedUserId);
  const authMethods = providerRows.map((p) => p.provider);

  const user = await db.prepare(
    "SELECT email, phone_number FROM users WHERE id = ?"
  ).get(matchedUserId);

  // Mask identifiers for privacy-safe display
  let maskedEmail = null;
  if (user?.email) {
    const parts = user.email.split("@");
    maskedEmail = parts[0].slice(0, 2) + "***@" + parts[1];
  }

  let maskedPhone = null;
  if (user?.phone_number && user.phone_number.length >= 8) {
    const code = user.phone_number.slice(0, 2);
    const last4 = user.phone_number.slice(-4);
    maskedPhone = `${code}***${last4}`;
  }

  return { exists: true, userId: matchedUserId, matchedVia, authMethods, maskedEmail, maskedPhone };
}

/**
 * In-memory rate limit check (fast-path cache only).
 * Used as a quick pre-check before the authoritative DB query.
 * @param {string} key - Rate limit key
 * @param {number} maxAttempts - Maximum attempts in window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} - true if rate limited (may be stale after restart)
 */
function isRateLimited(key, maxAttempts, windowMs) {
  const now = Date.now();
  const record = rateLimits.get(key);

  if (!record) {
    rateLimits.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (now - record.windowStart > windowMs) {
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
 * Extract client IP from request.
 * Uses request.ip which Fastify resolves correctly via the trustProxy setting.
 * Do not read x-forwarded-for directly — Fastify already handles that header.
 */
function getClientIp(request) {
  return request.ip || "unknown";
}

function normalizeIsoCountry(value) {
  if (typeof value !== "string") return null;
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function countryFromIp(ip) {
  const geo = geoip.lookup(ip);
  return normalizeIsoCountry(geo?.country);
}

function registrationCountry({ explicitCountry, clientIp }) {
  return normalizeIsoCountry(explicitCountry) || countryFromIp(clientIp);
}

/**
 * Create session and generate tokens for a user
 * @param {string} userId - User ID
 * @param {object} request - Fastify request object
 * @param {string} clientIp - Client IP address
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
async function createSessionAndTokens(userId, request, clientIp) {
  const session = await authService.createSession(userId, {
    deviceName: request.headers["user-agent"],
    ipAddress: clientIp,
    userAgent: request.headers["user-agent"],
  });

  const accessToken = authService.generateAccessToken(userId, { sessionId: session.id });
  const { token: refreshToken } = await authService.createRefreshToken(userId, { sessionId: session.id });

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
    const user = await authRouteDb.prepare(
      "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL"
    ).get(payload.sub);
    if (!user) {
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
    if (!payload.sid) {
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
    const session = await authRouteDb.prepare(
      "SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
    ).get(payload.sid, payload.sub);
    if (!session) {
      return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
    }
    request.sessionId = payload.sid;
    request.userId = payload.sub;
  } catch {
    return sendError(reply, 401, "INVALID_TOKEN", "Invalid or expired access token.");
  }
}

/**
 * Register auth routes on Fastify app
 */
function registerAuthRoutes(app, { db, subscriptionManager }) {
  authRouteDb = db;
  const attributionService = new AttributionService(db);
  // Initialize services with database
  authService.initialize(db);
  gdprAuditService.initialize(db);
  smsService.initialize(db);

  // Clean up expired registration tokens periodically (every 6 hours)
  const tokenCleanupInterval = setInterval(async () => {
    try {
      await db.prepare("DELETE FROM phone_registration_tokens WHERE expires_at < CURRENT_TIMESTAMP").run();
    } catch { /* non-critical cleanup */ }
  }, 6 * 60 * 60 * 1000);
  tokenCleanupInterval.unref();

  // Clean up expired rate limit entries periodically (every 30 minutes)
  // Cleans both in-memory cache and stale DB rows for auth-keyed entries
  const rateLimitCleanupInterval = setInterval(async () => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, entry] of rateLimits) {
      if (entry.windowStart < cutoff) rateLimits.delete(key);
    }
    try {
      await db.prepare(
        "DELETE FROM rate_limits WHERE action_type LIKE 'auth:%' AND window_start_ms < ?"
      ).run(cutoff);
    } catch { /* non-critical cleanup */ }
  }, 30 * 60 * 1000);
  rateLimitCleanupInterval.unref();

  /**
   * DB-backed rate limiting for auth endpoints.
   * Uses the existing rate_limits table with sliding window, same algorithm as server.js consumeRateLimit.
   * In-memory Map serves as fast-path cache; DB is authoritative and survives restarts.
   * @param {string} key - Rate limit key (e.g., "signup:192.168.1.1")
   * @param {number} limit - Maximum requests in window
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Promise<boolean>} - true if rate limited
   */
  async function consumeAuthRateLimit(key, limit, windowMs) {
    // Fast-path: in-memory check catches most cases without DB round-trip
    if (isRateLimited(key, limit, windowMs)) {
      return true;
    }

    // Authoritative check: DB-backed sliding window (survives restarts)
    try {
      const windowSeconds = Math.ceil(windowMs / 1000);
      const now = Date.now();
      const currentWindowStart = Math.floor(now / windowMs) * windowMs;
      const actionKey = `auth:${key}`;

      // Atomic increment current window
      await db.prepare(
        `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, action_type, window_start_ms)
         DO UPDATE SET count = rate_limits.count + 1`
      ).run(key, actionKey, currentWindowStart, windowSeconds, limit);

      // Read current + previous window for sliding window approximation
      const currentWindow = await db.prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
      ).get(key, actionKey, currentWindowStart);

      const previousWindowStart = currentWindowStart - windowMs;
      const previousWindow = await db.prepare(
        "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?"
      ).get(key, actionKey, previousWindowStart);

      const currentCount = currentWindow?.count || 0;
      const previousCount = previousWindow?.count || 0;
      const elapsedInWindow = now - currentWindowStart;
      const windowProgress = elapsedInWindow / windowMs;
      const weightedCount = currentCount + previousCount * (1 - windowProgress);

      if (weightedCount > limit) {
        // Roll back increment and deny
        await db.prepare(
          `UPDATE rate_limits SET count = MAX(count - 1, 0)
           WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`
        ).run(key, actionKey, currentWindowStart);
        return true;
      }

      return false;
    } catch (err) {
      // DB failure: fall back to in-memory result (already checked above and passed)
      console.error("[AuthRateLimit] DB error, falling back to in-memory:", err.message);
      return false;
    }
  }

  /**
   * Auto-link a recently-verified phone to a user after cross-identifier sign-in.
   * Only links if the phone was verified via OTP within the last 15 minutes
   * and is not already linked to another account.
   * Non-blocking — failures are logged but do not affect the auth response.
   */
  async function tryAutoLinkPhone(userId, phoneNumber, clientIp) {
    try {
      // Verify the phone was recently verified from this same IP (within 15 minutes).
      // Uses phone_registration_tokens (IP-bound) as proof that THIS client completed OTP.
      // This prevents cross-user phone hijacking: user A verifying a phone doesn't let
      // user B claim it via pending_phone_link from a different IP.
      const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const phoneHash = hashPhoneNumber(phoneNumber);
      const recentVerification = await db.prepare(
        `SELECT token_hash FROM phone_registration_tokens
         WHERE phone_number_hash = ? AND verified_at > ?
           AND (ip_address = ? OR ip_address IS NULL)
         ORDER BY verified_at DESC LIMIT 1`
      ).get(phoneHash, cutoff, clientIp);

      if (!recentVerification) {
        return; // No recent verification from this IP — skip
      }

      // Check if phone is already linked to another account
      const existingLink = await db.prepare(
        "SELECT user_id FROM user_auth_providers WHERE provider = 'phone' AND provider_user_id = ?"
      ).get(phoneNumber);

      if (existingLink) {
        return; // Already linked (to this or another user) — skip
      }

      // Link phone to this user via identity service
      await identityService.linkIdentityToUser(db, userId, {
        type: "phone",
        subject: phoneNumber,
        verifiedAt: new Date().toISOString(),
      });

      await authService.logAuthEvent({
        userId,
        eventType: "provider_linked",
        ipAddress: clientIp,
        metadata: { provider: "phone", linked_via: "pending_phone_link", phone_masked: phoneNumber.slice(0, 4) + "****" + phoneNumber.slice(-2) },
      });
    } catch (err) {
      // UNIQUE constraint = phone was linked concurrently. Non-critical.
      if (err.code !== "23505" && !err.message?.includes("UNIQUE constraint")) {
        console.error("[AutoLinkPhone] Failed:", err.message);
      }
    }
  }

  // Attribution matching — links a new user to a recent /download event by IP
  async function matchDownloadAttribution(userId, clientIp) {
    try {
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const event = await db.prepare(
        `SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
         FROM download_events
         WHERE ip_address = ? AND created_at > ? AND matched_user_id IS NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(clientIp, cutoff);

      if (!event) return;

      await attributionService.backfillUserAcquisitionFromDownload(userId, event);

      await db.prepare(
        `UPDATE download_events SET matched_user_id = ? WHERE id = ?`
      ).run(userId, event.id);
    } catch (err) {
      console.error("Attribution matching failed:", err.message);
    }
  }

  // Receiver (viral-loop) attribution — links a new user to a recent receiver_sessions row by IP.
  // A gift recipient opened a shared song/poem, installed, and registered; this is what makes the
  // recipient->registration step observable (matched_user_id), the success metric for the viral loop.
  // Mirrors matchDownloadAttribution's IP + time-window approach (same fuzziness tradeoff, NAT-bounded).
  // receiver-session-service.markAppOpened is the deterministic writer (real userId from the in-app
  // handoff); this is the heuristic fallback for users who register without it. The `matched_user_id
  // IS NULL` guard lets the two coexist safely — whichever writes first wins.
  async function matchReceiverAttribution(userId, clientIp) {
    // getClientIp returns "unknown" (never falsy) when the IP is unresolved — skip it so an
    // IP-less registrant can never cross-match a receiver row that also stored "unknown".
    if (!clientIp || clientIp === "unknown") return;
    try {
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const session = await db.prepare(
        `SELECT id
         FROM receiver_sessions
         WHERE matched_user_id IS NULL
           AND (last_ip_address = ? OR first_ip_address = ?)
           AND created_at > ?
         ORDER BY updated_at DESC LIMIT 1`
      ).get(clientIp, clientIp, cutoff);

      if (!session) return;

      const now = new Date().toISOString();
      await db.prepare(
        `UPDATE receiver_sessions
         SET matched_user_id = ?, updated_at = ?
         WHERE id = ? AND matched_user_id IS NULL`
      ).run(userId, now, session.id);
    } catch (err) {
      console.error("Receiver attribution matching failed:", err.message);
    }
  }

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
        pending_phone_link: { type: "string", pattern: "^\\+[1-9]\\d{1,14}$" },
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
        confirm_link: { type: "boolean" },
        pending_phone_link: { type: "string", pattern: "^\\+[1-9]\\d{1,14}$" },
        locale: { type: "string", maxLength: 10 },
        country: { type: "string", maxLength: 2 },
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
      required: ["registration_token", "phone_number"],
      properties: {
        registration_token: { type: "string", minLength: 64, maxLength: 64 },
        phone_number: { type: "string", pattern: "^\\+[1-9]\\d{1,14}$" },
        name: { type: "string", maxLength: 100 },
        email: { type: "string", format: "email", maxLength: 255 },
        locale: { type: "string", maxLength: 10 },
        country: { type: "string", maxLength: 2 },
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

  const profileUpdateSchema = {
    body: {
      type: "object",
      properties: {
        contact_email: { type: "string", format: "email", maxLength: 255 },
        display_name: { type: "string", maxLength: 100 },
      },
      additionalProperties: false,
    },
  };

  // ==================== SIGNUP ====================

  app.post("/auth/signup", { schema: signupSchema }, async (request, reply) => {
    const { email, password, name, locale, country } = request.body;
    const clientIp = getClientIp(request);
    const countryCode = registrationCountry({ explicitCountry: country, clientIp });

    // Rate limit: 5/hour per IP
    if (await consumeAuthRateLimit(`signup:${clientIp}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many signup attempts. Please try again later.");
    }

    try {
      // Check if email already exists with a verified contact (exclude soft-deleted and unverified claims)
      // Unverified emails from phone registration don't block legitimate email/password signup
      const existing = await db.prepare(
        `SELECT uc.user_id as id FROM user_contacts uc
         JOIN users u ON u.id = uc.user_id AND u.deleted_at IS NULL
         WHERE uc.type = 'email' AND uc.value_normalized = ? AND uc.verified_at IS NOT NULL
         LIMIT 1`
      ).get(email.toLowerCase());
      if (existing) {
        return sendError(reply, 409, "EMAIL_EXISTS", "An account with this email already exists.");
      }

      // Prepare password hash before transaction (async bcrypt must happen outside)
      const now = new Date().toISOString();
      const passwordHash = await authService.hashPassword(password);

      // Create user + email identity + email contact via identity service
      const { userId } = await identityService.createUserWithIdentity(
        db,
        { type: "email", subject: identityService.normalizeEmail(email), verifiedAt: null },
        {
          contacts: [{ type: "email", value: email, source: "user_entered", verified: false }],
          profile: { displayName: name || null, locale: locale || null, country: countryCode },
        }
      );

      // Store password credential + entitlements — compensate on failure to avoid orphaned user
      try {
        await db.prepare(
          `INSERT INTO user_credentials (user_id, password_hash, created_at)
           VALUES (?, ?, ?)`
        ).run(userId, passwordHash, now);

        await subscriptionManager.createFreeEntitlements(userId, { now });
      } catch (err) {
        console.error("[EmailSignup] Post-creation failed, cleaning up orphaned user:", err.message);
        await db.prepare("DELETE FROM user_contacts WHERE user_id = ?").run(userId);
        await db.prepare("DELETE FROM user_auth_providers WHERE user_id = ?").run(userId);
        await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
        throw err;
      }

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(userId, request, clientIp);

      // Attribution matching (non-blocking)
      matchDownloadAttribution(userId, clientIp).catch(() => {});
      matchReceiverAttribution(userId, clientIp).catch(() => {});

      // Send verification email (don't await - fire and forget)
      if (emailService.isConfigured()) {
        authService.createEmailVerificationToken(userId, { email: email.toLowerCase() }).then(({ token }) => {
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

    // Rate limit: 10/hour per ip:email combination (prevents credential stuffing across accounts)
    if (await consumeAuthRateLimit(`login:${clientIp}:${normalizedEmail}`, 10, 60 * 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many login attempts. Please try again later.");
    }

    try {
      // Find user via identity service (email identity in user_auth_providers)
      const resolved = await identityService.resolveUserByIdentity(db, "email", normalizedEmail);
      const user = resolved ? { id: resolved.userId } : null;

      // Check account lock BEFORE bcrypt to avoid wasting CPU on locked accounts
      if (user) {
        const isLocked = await authService.isAccountLocked(user.id);
        if (isLocked) {
          return sendError(reply, 403, "ACCOUNT_LOCKED", "Account is temporarily locked. Please try again later.");
        }
      }

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
          // Mask email to avoid storing full PII in audit log while preserving debuggability
          const maskedEmail = normalizedEmail.slice(0, 2) + "***@" + (normalizedEmail.split("@")[1] || "");
          await authService.logAuthEvent({
            eventType: "login_failed",
            ipAddress: clientIp,
            metadata: { email: maskedEmail, reason: "user_not_found" },
          });
        }

        return sendError(reply, 401, "INVALID_CREDENTIALS", "Invalid email or password.");
      }

      // Reset failed login count on success
      await authService.resetFailedLoginCount(user.id);

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(user.id, request, clientIp);

      // Auto-link pending phone if present (from cross-identifier flow)
      if (request.body.pending_phone_link) {
        tryAutoLinkPhone(user.id, request.body.pending_phone_link, clientIp).catch(() => {});
      }

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
      locale,
      country,
    } = request.body;
    const clientIp = getClientIp(request);
    const countryCode = registrationCountry({ explicitCountry: country, clientIp });

    // Rate limit: 20/hour per IP
    if (await consumeAuthRateLimit(`social:${clientIp}`, 20, 60 * 60 * 1000)) {
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
      const userEmail = verifiedToken.emailVerified ? verifiedToken.email : null;
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

      // Resolve user by identity via identity service
      let resolved = await identityService.resolveUserByIdentity(db, provider, providerUserId);

      // Handle orphaned provider rows pointing to deleted users
      if (!resolved) {
        const orphan = await db.prepare(
          `SELECT uap.id FROM user_auth_providers uap
           JOIN users u ON u.id = uap.user_id
           WHERE uap.provider = ? AND uap.provider_user_id = ? AND u.deleted_at IS NOT NULL`
        ).get(provider, providerUserId);
        if (orphan) {
          await db.prepare("UPDATE user_auth_providers SET status = 'revoked' WHERE id = ?").run(orphan.id);
          console.warn(`[SocialAuth] Revoked orphaned provider ${orphan.id} for deleted user`);
        }
      }

      let userId;
      let identityId;
      let isNewUser = false;
      let autoLinked = false;

      if (resolved) {
        // Existing identity — sign in
        userId = resolved.userId;
        identityId = resolved.identity.id;

        // Record usage on this identity
        await identityService.recordIdentityUsage(db, identityId);

        // If provider already linked and we have a new Apple refresh token, update provider_data
        if (provider === "apple" && appleRefreshToken) {
          let providerData = {};
          if (resolved.identity.providerData) {
            try {
              providerData = typeof resolved.identity.providerData === "string"
                ? JSON.parse(resolved.identity.providerData)
                : resolved.identity.providerData;
            } catch {
              providerData = {};
            }
          }
          providerData.apple_refresh_token = appleRefreshToken;
          providerData.apple_refresh_obtained_at = new Date().toISOString();
          await db
            .prepare("UPDATE user_auth_providers SET provider_data = ? WHERE id = ?")
            .run(JSON.stringify(providerData), identityId);
        }

        // If Apple provides email, ensure contact exists
        if (userEmail) {
          await identityService.createOrUpdateContact(db, userId, {
            type: "email",
            value: userEmail.toLowerCase(),
            source: "apple_claim",
            sourceIdentityId: identityId,
          });
        }
      } else {
        // New identity — check for email-based account linking or create new user
        isNewUser = true;

        // Check if email already exists via contacts (link accounts, exclude soft-deleted)
        // Only auto-link if the existing account's email is verified AND user confirms
        if (userEmail) {
          const existingUser = await db.prepare(
            `SELECT uc.user_id as id FROM user_contacts uc
             JOIN users u ON u.id = uc.user_id AND u.deleted_at IS NULL
             WHERE uc.type = 'email' AND uc.value_normalized = ? AND uc.verified_at IS NOT NULL
             LIMIT 1`
          ).get(userEmail.toLowerCase());
          if (existingUser) {
            if (!request.body.confirm_link) {
              // Require explicit confirmation before linking to existing account
              const emailParts = userEmail.toLowerCase().split("@");
              const maskedEmail = emailParts[0].slice(0, 2) + "***@" + emailParts[1];
              return reply.status(200).send({
                requires_link_confirmation: true,
                existing_account_email: maskedEmail,
                provider,
              });
            }
            userId = existingUser.id;
            isNewUser = false;
            autoLinked = true;
          }
        }

        const now = new Date().toISOString();
        const providerData = {
          email: userEmail,
          ...(appleRefreshToken ? { apple_refresh_token: appleRefreshToken, apple_refresh_obtained_at: now } : {}),
        };

        if (isNewUser) {
          // Create user + identity atomically via identity service
          const contacts = [];
          if (userEmail) {
            contacts.push({
              type: "email",
              value: userEmail.toLowerCase(),
              source: provider === "apple" ? "apple_claim" : "provider_sync",
              verified: !!verifiedToken.emailVerified,
            });
          }

          const result = await identityService.createUserWithIdentity(
            db,
            { type: provider, subject: providerUserId, providerData, verifiedAt: now },
            { contacts, profile: { displayName: userName, locale: locale || null, country: countryCode } }
          );
          userId = result.userId;
          identityId = result.identityId;

          // Create free entitlements — compensate on failure
          try {
            await subscriptionManager.createFreeEntitlements(userId, { now });
          } catch (err) {
            console.error("[SocialAuth] Entitlement creation failed, cleaning up orphaned user:", err.message);
            await db.prepare("DELETE FROM user_contacts WHERE user_id = ?").run(userId);
            await db.prepare("DELETE FROM user_auth_providers WHERE user_id = ?").run(userId);
            await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
            throw err;
          }
        } else {
          // Link identity to existing user (auto-link via email match)
          const result = await identityService.linkIdentityToUser(db, userId, {
            type: provider,
            subject: providerUserId,
            providerData,
            verifiedAt: now,
          });
          identityId = result.identityId;
        }

        // Record initial usage
        await identityService.recordIdentityUsage(db, identityId);
      }

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(userId, request, clientIp);

      // Auto-link pending phone if present (from cross-identifier flow)
      if (request.body.pending_phone_link) {
        tryAutoLinkPhone(userId, request.body.pending_phone_link, clientIp).catch(() => {});
      }

      // Attribution matching for new social signups (non-blocking)
      if (isNewUser) {
        matchDownloadAttribution(userId, clientIp).catch(() => {});
        matchReceiverAttribution(userId, clientIp).catch(() => {});
      }

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: provider, is_new_user: isNewUser },
      });

      // Log provider_linked when auto-linking social to existing account
      if (autoLinked) {
        await authService.logAuthEvent({
          userId,
          eventType: "provider_linked",
          ipAddress: clientIp,
          userAgent: request.headers["user-agent"],
          metadata: { provider, provider_user_id: providerUserId, linked_via: "email_match" },
        });
      }

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
      const accessToken = authService.generateAccessToken(result.userId, { sessionId: result.sessionId || null });

      // Record identity usage on refresh (non-blocking)
      // Find the identity associated with this user's most recent sign-in method
      const recentIdentity = await db.prepare(
        `SELECT id FROM user_auth_providers
         WHERE user_id = ? AND status = 'active'
         ORDER BY last_used_at DESC LIMIT 1`
      ).get(result.userId);
      if (recentIdentity) {
        identityService.recordIdentityUsage(db, recentIdentity.id).catch((err) => {
          console.error("[TokenRefresh] Failed to record identity usage:", err.message);
        });
      }

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

      if (error.code === "SESSION_REVOKED") {
        return sendError(reply, 401, "SESSION_REVOKED", "Session revoked. Please login again.");
      }

      if (error.code === "SESSION_BINDING_REQUIRED") {
        return sendError(reply, 401, "SESSION_EXPIRED", "Session expired. Please sign in again.");
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
      await authService.revokeAllRefreshTokensForUser(payload.sub);

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
    if (await consumeAuthRateLimit(`forgot:${normalizedEmail}`, 3, 60 * 60 * 1000)) {
      // Still return 200 to prevent enumeration
      return reply.send({ message: "If an account exists, a reset email has been sent." });
    }

    try {
      // Find user via identity service (email identity in user_auth_providers)
      const resolved = await identityService.resolveUserByIdentity(db, "email", normalizedEmail);
      const user = resolved ? { id: resolved.userId } : null;

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
      await authService.revokeAllRefreshTokensForUser(userId);
      await authService.compromiseAllTokenFamiliesForUser(userId);

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
      const { userId, tokenId, email_normalized: emailNormalized } = await authService.verifyEmailVerificationToken(token);
      const emailToVerify = emailNormalized
        || (await db.prepare("SELECT email FROM users WHERE id = ?").get(userId))?.email;
      if (emailToVerify) {
        await identityService.verifyContact(db, userId, "email", emailToVerify, "email_token");
      }

      // email_verified now synced via identity service mirror (syncUserContactMirrors)

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
      // Identity service conflict: another account already verified this email
      if (error instanceof identityService.IdentityError && error.code === "E119_EMAIL_CONFLICT") {
        return sendError(reply, 409, "EMAIL_ALREADY_VERIFIED", "This email is already verified by another account. Please use a different email or sign in to the existing account.");
      }
      // Legacy unique constraint violation
      if (error.code === "23505" || error.message?.includes("UNIQUE constraint") || error.message?.includes("idx_users_verified_email")) {
        return sendError(reply, 409, "EMAIL_ALREADY_VERIFIED", "This email is already verified by another account. Please use a different email or sign in to the existing account.");
      }
      return sendError(reply, 400, "INVALID_TOKEN", "Invalid or expired verification token.");
    }
  });

  // ==================== USER PROFILE HELPERS ====================

  async function buildUserProfileResponse(userId) {
    const user = await db.prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.email_verified,
                u.phone_number, u.username, u.created_at, u.profile_completion_skipped_at
         FROM users u
         WHERE u.id = ?
           AND u.deleted_at IS NULL`
    ).get(userId);

    if (!user) return null;

    // Auth methods with linked_at and last_used_at
    const providerRows = await db
      .prepare(
        `SELECT provider, provider_user_id, linked_at, last_used_at
         FROM user_auth_providers WHERE user_id = ? AND status = 'active'`
      )
      .all(userId);
    const providers = providerRows.map((p) => p.provider);

    const authMethods = providerRows.map((p) => {
      const method = { type: p.provider, linked_at: p.linked_at, last_used_at: p.last_used_at };
      if (p.provider === "phone" && p.provider_user_id) {
        // Mask phone: +1***1234
        method.subject_masked = p.provider_user_id.slice(0, 3) + "***" + p.provider_user_id.slice(-4);
      }
      return method;
    });

    // Contacts from user_contacts table
    const contactRows = await db
      .prepare(
        `SELECT id, type, value_normalized, value_display, verified_at, is_primary, is_relay
         FROM user_contacts WHERE user_id = ?`
      )
      .all(userId);

    const contacts = contactRows.map((c) => ({
      type: c.type,
      value_display: c.value_display || c.value_normalized,
      verified: !!c.verified_at,
      is_primary: !!c.is_primary,
      ...(c.type === "email" ? { is_relay: !!c.is_relay } : {}),
    }));

    // Derive primary email and phone from contacts (prefer verified primary)
    const primaryEmailContact = contactRows.find((c) => c.type === "email" && c.is_primary && c.verified_at);
    const primaryPhoneContact = contactRows.find((c) => c.type === "phone" && c.is_primary && c.verified_at);

    // Profile completeness via identity service
    const completeness = await identityService.computeProfileCompleteness(db, userId);

    return {
      // Existing fields (backward compat)
      user_id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      email_verified: Boolean(user.email_verified),
      providers,
      created_at: user.created_at,
      phone_number: user.phone_number || null,
      username: user.username || null,
      // New identity-layer fields
      auth_methods: authMethods,
      contacts,
      primary_email: primaryEmailContact?.value_normalized || user.email || null,
      primary_phone: primaryPhoneContact?.value_normalized || user.phone_number || null,
      needs_profile_completion: !completeness.complete,
      missing_profile_requirements: completeness.missing,
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

  app.patch("/auth/profile", { schema: profileUpdateSchema, preHandler: requireAuth }, async (request, reply) => {
    const { contact_email, display_name } = request.body || {};

    if (!contact_email && !display_name) {
      return sendError(reply, 400, "MISSING_FIELDS", "At least one field (contact_email, display_name) is required.");
    }

    // Fetch current user once for change detection (avoids redundant queries)
    const currentUser = await db.prepare("SELECT email FROM users WHERE id = ?").get(request.userId);

    // Validate email format if provided
    if (contact_email != null) {
      const emailStr = String(contact_email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
        return sendError(reply, 400, "INVALID_EMAIL", "Please provide a valid email address.");
      }
      // Check uniqueness only if email actually changed
      if (!currentUser || currentUser.email !== emailStr) {
        const existing = await db.prepare(
          `SELECT uc.user_id as id FROM user_contacts uc
           WHERE uc.type = 'email' AND uc.value_normalized = ? AND uc.verified_at IS NOT NULL AND uc.user_id != ?
           LIMIT 1`
        ).get(emailStr, request.userId);
        if (existing) {
          return sendError(reply, 409, "EMAIL_EXISTS", "This email is already associated with another account.");
        }
      }
    }

    // Update display_name directly on users table
    if (display_name != null) {
      const trimmedName = String(display_name).trim();
      if (trimmedName.length > 100) {
        return sendError(reply, 400, "INVALID_DISPLAY_NAME", "Display name must be 100 characters or fewer.");
      }
      await db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(trimmedName, request.userId);
    }

    // Handle email via identity service — creates/updates UNVERIFIED contact.
    // Mirror sync happens only after verification.
    if (contact_email != null) {
      const newEmail = String(contact_email).trim().toLowerCase();
      const emailChanged = !currentUser || currentUser.email !== newEmail;

      // Create or update contact as unverified
      const contactResult = await identityService.createOrUpdateContact(db, request.userId, {
        type: "email",
        value: newEmail,
        source: "user_entered",
      });

      // Send verification email for changed email (fire-and-forget)
      if (emailChanged) {
        await authService.invalidateEmailVerificationTokens(request.userId);
      }
      if (emailChanged && emailService.isConfigured()) {
        authService.createEmailVerificationToken(request.userId, { email: newEmail, contactId: contactResult.contactId })
          .then(({ token }) => emailService.sendVerificationEmail(newEmail, token))
          .catch((err) => {
            console.error("[ProfileUpdate] Failed to send verification email:", err.message);
          });
      }
    }

    const profile = await buildUserProfileResponse(request.userId);
    return reply.send(profile);
  });

  // ==================== SKIP PROFILE COMPLETION ====================

  app.post("/auth/profile/skip-completion", { preHandler: requireAuth }, async (request, reply) => {
    // Analytics-only: records skip timestamp but does NOT affect needs_profile_completion.
    // buildUserProfileResponse uses computeProfileCompleteness() which ignores skip state.
    await db.prepare(
      "UPDATE users SET profile_completion_skipped_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(request.userId);

    return reply.send({ success: true });
  });

  // ==================== PHONE LINKING (AUTHENTICATED) ====================

  const phoneLinkSchema = {
    body: {
      type: "object",
      required: ["phone_number", "code"],
      properties: {
        phone_number: { type: "string", pattern: "^\\+[1-9]\\d{1,14}$" },
        code: { type: "string", minLength: 6, maxLength: 6 },
      },
    },
  };

  app.post("/auth/phone/link", { schema: phoneLinkSchema, preHandler: requireAuth }, async (request, reply) => {
    const { phone_number, code } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 3 attempts per hour per user
    if (await consumeAuthRateLimit(`phone-link:${request.userId}`, 3, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many linking attempts. Please try again later.");
    }

    try {
      // Verify OTP code
      const result = await smsService.verifyCode(phone_number, code);
      if (!result.verified) {
        return reply.status(400).send({
          success: false,
          verified: false,
          remaining_attempts: result.remainingAttempts,
          error: result.error || "Invalid verification code.",
        });
      }

      // Check if phone is already linked to THIS user (idempotent)
      const existingSelf = await db.prepare(
        `SELECT id FROM user_auth_providers
         WHERE user_id = ? AND provider = 'phone' AND provider_user_id = ?`
      ).get(request.userId, phone_number);

      if (existingSelf) {
        const profile = await buildUserProfileResponse(request.userId);
        return reply.send({ success: true, already_linked: true, ...profile });
      }

      // Link phone identity via identity service (handles conflict detection + contact creation + mirror sync)
      const now = new Date().toISOString();
      await identityService.linkIdentityToUser(db, request.userId, {
        type: "phone",
        subject: phone_number,
        verifiedAt: now,
      });

      // Log auth event
      await authService.logAuthEvent({
        userId: request.userId,
        eventType: "provider_linked",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { provider: "phone", phone_masked: phone_number.slice(0, 4) + "****" + phone_number.slice(-2) },
      });

      const profile = await buildUserProfileResponse(request.userId);
      return reply.send({ success: true, ...profile });
    } catch (error) {
      // Identity service conflict: phone already linked to another user
      if (error instanceof identityService.IdentityError && error.code === "E118_PROVIDER_ALREADY_LINKED") {
        return sendError(reply, 409, "E117_PHONE_EXISTS", "This phone number is already associated with another account.");
      }
      // Catch UNIQUE constraint violation (race condition: phone linked to another user concurrently)
      if (error.code === "23505" || error.message?.includes("UNIQUE constraint")) {
        return sendError(reply, 409, "E117_PHONE_EXISTS", "This phone number is already associated with another account.");
      }
      console.error("Phone link error:", error);
      return sendError(reply, 500, "E119_PHONE_ERROR", "Failed to link phone number. Please try again.");
    }
  });

  // ==================== APPLE IDENTITY LINKING (AUTHENTICATED) ====================

  const appleLinkSchema = {
    body: {
      type: "object",
      required: ["id_token", "nonce"],
      properties: {
        id_token: { type: "string" },
        nonce: { type: "string", minLength: 8, maxLength: 256 },
        authorization_code: { type: "string", maxLength: 2048 },
        provider_user_id: { type: "string", maxLength: 255 },
      },
    },
  };

  app.post("/auth/identity/link/apple", { schema: appleLinkSchema, preHandler: requireAuth }, async (request, reply) => {
    const { id_token, nonce, authorization_code } = request.body;
    const clientIp = getClientIp(request);

    // Rate limit: 3 attempts per hour per user
    if (await consumeAuthRateLimit(`apple-link:${request.userId}`, 3, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many linking attempts. Please try again later.");
    }

    try {
      // Verify Apple token (reuse existing verifier)
      const verifiedToken = await verifySocialToken("apple", id_token, { rawNonce: nonce });

      const appleSub = verifiedToken.sub;
      if (!appleSub) {
        return sendError(reply, 400, "INVALID_TOKEN", "Could not extract user ID from Apple token.");
      }

      const now = new Date().toISOString();
      const providerData = {
        email: verifiedToken.email,
        emailVerified: verifiedToken.emailVerified,
        isPrivateEmail: verifiedToken.isPrivateEmail,
      };

      // Link Apple identity via identity service
      const { identityId } = await identityService.linkIdentityToUser(db, request.userId, {
        type: "apple",
        subject: appleSub,
        providerData,
        verifiedAt: now,
      });

      // Exchange authorization_code for refresh token (optional, non-blocking for link success)
      if (authorization_code) {
        try {
          const exchange = await exchangeAppleAuthorizationCode(authorization_code);
          if (exchange.refresh_token) {
            providerData.apple_refresh_token = exchange.refresh_token;
            providerData.apple_refresh_obtained_at = now;
            await db.prepare(
              "UPDATE user_auth_providers SET provider_data = ? WHERE id = ?"
            ).run(JSON.stringify(providerData), identityId);
          }
        } catch (exchangeError) {
          console.warn("[AppleLink] Auth code exchange failed:", exchangeError.message);
          // Non-fatal — identity is already linked
        }
      }

      // If Apple provides email, ensure contact exists
      if (verifiedToken.email) {
        await identityService.createOrUpdateContact(db, request.userId, {
          type: "email",
          value: verifiedToken.email.toLowerCase(),
          source: "apple_claim",
          sourceIdentityId: identityId,
        });
      }

      // Log auth event
      await authService.logAuthEvent({
        userId: request.userId,
        eventType: "provider_linked",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { provider: "apple", provider_user_id: appleSub },
      });

      const profile = await buildUserProfileResponse(request.userId);
      return reply.send({ success: true, ...profile });
    } catch (error) {
      // Identity service conflicts: Apple ID or email already linked to another user
      if (error instanceof identityService.IdentityError) {
        if (error.code === "E118_PROVIDER_ALREADY_LINKED") {
          return sendError(reply, 409, "E118_PROVIDER_ALREADY_LINKED", "This Apple ID is already associated with another account.");
        }
        if (error.code === "E119_EMAIL_CONFLICT") {
          return sendError(reply, 409, "E119_EMAIL_CONFLICT", "The email on this Apple ID is already linked to another account.");
        }
      }
      console.error("Apple link error:", error);
      return sendError(reply, 500, "LINK_ERROR", "Failed to link Apple ID. Please try again.");
    }
  });

  // ==================== EMAIL RESEND VERIFICATION (AUTHENTICATED) ====================

  app.post("/auth/email/resend-verification", { preHandler: requireAuth }, async (request, reply) => {
    // Rate limit: 3 per hour per user
    if (await consumeAuthRateLimit(`resend-verify:${request.userId}`, 3, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many verification requests. Please try again later.");
    }

    try {
      // Get current user's unverified email from user_contacts
      const unverifiedEmail = await db.prepare(
        `SELECT value_normalized FROM user_contacts
         WHERE user_id = ? AND type = 'email' AND verified_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(request.userId);

      if (!unverifiedEmail) {
        return sendError(reply, 400, "NO_PENDING_VERIFICATION", "No unverified email address found.");
      }

      // Send verification for contact email
      if (!emailService.isConfigured()) {
        return sendError(reply, 503, "EMAIL_NOT_CONFIGURED", "Email verification is not available.");
      }

      const { token } = await authService.createEmailVerificationToken(request.userId, {
        email: unverifiedEmail.value_normalized,
      });
      await emailService.sendVerificationEmail(unverifiedEmail.value_normalized, token);

      const emailParts = unverifiedEmail.value_normalized.split("@");
      const maskedEmail = emailParts[0].slice(0, 2) + "***@" + emailParts[1];

      return reply.send({ success: true, email_masked: maskedEmail });
    } catch (error) {
      console.error("Resend verification error:", error);
      return sendError(reply, 500, "E119_EMAIL_ERROR", "Failed to send verification email. Please try again.");
    }
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
    if (await consumeAuthRateLimit(`phone-send:${clientIp}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many verification requests. Please try again later.");
    }

    // Validate E.164 format before per-phone rate limit so we don't key on garbage input
    if (!isValidE164(phone_number)) {
      return sendError(reply, 400, "E111_INVALID_PHONE", "Invalid phone number format. Use E.164 format (e.g., +12025551234).");
    }

    // Rate limit: 5/hour per phone number — prevents SMS bombing a single number from multiple IPs
    if (await consumeAuthRateLimit(`sms:phone:${phone_number}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many verification requests for this number.");
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
    if (await consumeAuthRateLimit(`phone-verify:${clientIp}`, 10, 60 * 60 * 1000)) {
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
        // Resolve user by phone identity via identity service
        const resolved = await identityService.resolveUserByIdentity(db, "phone", phone_number);

        if (resolved) {
          // Phone already registered - login
          await identityService.recordIdentityUsage(db, resolved.identity.id);

          const { accessToken, refreshToken } = await createSessionAndTokens(resolved.userId, request, clientIp);

          await authService.logAuthEvent({
            userId: resolved.userId,
            eventType: "login_success",
            ipAddress: clientIp,
            userAgent: request.headers["user-agent"],
            metadata: { method: "phone" },
          });

          return reply.send({
            success: true,
            verified: true,
            existing_user: true,
            user_id: resolved.userId,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600,
          });
        }

        // New phone - create registration token for signup
        const registrationToken = await createRegistrationToken(db, phone_number, clientIp);

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
    const { registration_token, phone_number, name, email, locale, country } = request.body;
    const clientIp = getClientIp(request);
    const countryCode = registrationCountry({ explicitCountry: country, clientIp });
    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

    // Rate limit: 5/hour per IP (same as signup)
    if (await consumeAuthRateLimit(`phone-register:${clientIp}`, 5, 60 * 60 * 1000)) {
      return sendError(reply, 429, "E110_RATE_LIMITED", "Too many registration attempts. Please try again later.");
    }

    try {
      // Validate registration token against provided phone number
      const tokenResult = await consumeRegistrationToken(db, registration_token, phone_number, clientIp);
      if (!tokenResult.valid) {
        return sendError(reply, 400, "E114_INVALID_TOKEN", "Invalid or expired registration token. Please verify your phone again.");
      }

      const phoneNumber = tokenResult.phone_number;

      // Cross-identifier dedup: check phone AND email (if provided) against existing accounts
      // Email cross-check only matches verified emails (prevents unverified email claims)
      const existingAccount = await findExistingAccountByIdentifiers(db, {
        phone: phoneNumber,
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
      });

      if (existingAccount.exists) {
        // Privacy: caller verified ownership of THIS phone via OTP. If the matched
        // account was found via email (not phone), the matched user's phone may be
        // different — never disclose another user's phone to a caller who only
        // proved phone X. Only return masked_phone when the phone match itself
        // located the account.
        const safeMaskedPhone = existingAccount.matchedVia === "phone"
          ? existingAccount.maskedPhone
          : null;
        return reply.status(200).send({
          account_exists: true,
          auth_methods: existingAccount.authMethods,
          masked_email: existingAccount.maskedEmail,
          masked_phone: safeMaskedPhone,
        });
      }

      // Create user + phone identity via identity service
      const now = new Date().toISOString();
      const contacts = [
        { type: "phone", value: phoneNumber, source: "phone_otp", verified: true },
      ];
      if (normalizedEmail) {
        contacts.push({ type: "email", value: normalizedEmail, source: "user_entered", verified: false });
      }

      const { userId, identityId } = await identityService.createUserWithIdentity(
        db,
        { type: "phone", subject: phoneNumber, verifiedAt: now },
        { contacts, profile: { displayName: name || null, locale: locale || null, country: countryCode } }
      );

      // Create free entitlements — compensate on failure
      try {
        await subscriptionManager.createFreeEntitlements(userId, { now });
      } catch (err) {
        console.error("[PhoneRegister] Entitlement creation failed, cleaning up orphaned user:", err.message);
        await db.prepare("DELETE FROM user_contacts WHERE user_id = ?").run(userId);
        await db.prepare("DELETE FROM user_auth_providers WHERE user_id = ?").run(userId);
        await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
        throw err;
      }

      // Record initial usage
      await identityService.recordIdentityUsage(db, identityId);

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(userId, request, clientIp);

      // Send verification email for self-asserted email (fire-and-forget)
      if (normalizedEmail && emailService.isConfigured()) {
        authService.createEmailVerificationToken(userId, { email: normalizedEmail }).then(({ token }) => {
          emailService.sendVerificationEmail(normalizedEmail, token).catch((err) => {
            console.error("Failed to send verification email:", err.message);
          });
        });
      }

      // Attribution matching (non-blocking)
      matchDownloadAttribution(userId, clientIp).catch(() => {});
      matchReceiverAttribution(userId, clientIp).catch(() => {});

      // Log event
      await authService.logAuthEvent({
        userId,
        eventType: "login_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: "phone_signup", has_email: Boolean(normalizedEmail) },
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
    const clientIp = getClientIp(request);

    // Rate limit: 30/minute per IP to prevent bulk username enumeration
    if (await consumeAuthRateLimit(`username-check:${clientIp}`, 30, 60 * 1000)) {
      return sendError(reply, 429, "RATE_LIMITED", "Too many requests. Please try again later.");
    }

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
    if (await consumeAuthRateLimit(`delete-account:${request.userId}`, 1, 60 * 60 * 1000)) {
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
