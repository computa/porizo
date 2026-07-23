/**
 * Authentication Routes
 *
 * Handles user signup, login, social auth, token refresh,
 * password reset, and email verification.
 */

const authService = require("../services/auth-service");
const { parseCookieHeader } = require("../utils/http-cookies");
const emailService = require("../services/email-service");
const smsService = require("../services/sms-service");
const gdprAuditService = require("../services/gdpr-audit-service");
const identityService = require("../services/identity-service");
const { AttributionService } = require("../services/attribution-service");
const {
  createAuthSessionRepository,
} = require("../database/auth-session-repository");
const {
  createAuthRefreshTokenRepository,
} = require("../database/auth-refresh-token-repository");
const {
  createAuthRateLimitRepository,
} = require("../database/auth-rate-limit-repository");
const {
  createAuthProfileRepository,
} = require("../database/auth-profile-repository");
const {
  createAuthProviderLinkingRepository,
} = require("../database/auth-provider-linking-repository");
const {
  createAuthCredentialRepository,
} = require("../database/auth-credential-repository");
const { createIdentityRepository } = require("../database/identity-repository");
const { dbQuery } = require("../utils/db-adapter");
const {
  reclaimGuestOrdersOnLogin,
} = require("../services/web-order-login-reclaim");
const {
  createMagicLoginRepository,
} = require("../database/magic-login-repository");
const { createMagicLoginService } = require("../services/magic-login-service");
const {
  getEtsyFulfilmentMode,
} = require("../services/etsy-fulfilment-mode");
const {
  createContactDeliveryService,
} = require("../services/contact-delivery-service");
const {
  createPhoneRegistrationTokenRepository,
} = require("../database/phone-registration-token-repository");
const {
  createReceiverSessionRepository,
} = require("../database/receiver-session-repository");
const { createRequireUser } = require("../middleware/require-user");
const { sendError } = require("../utils/http-error");
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
const { getClientIp: extractClientIp } = require("../utils/client-ip");

let authRouteSessionRepository = null;
let authRouteRateLimitRepository = null;
let authRouteProfileRepository = null;
let authRouteProviderLinkingRepository = null;
let authRouteCredentialRepository = null;
let authRouteReceiverSessionRepository = null;
let requireAuthUser = null;

function phoneRegistrationTokenRepositoryFor(dbOrRepository) {
  if (dbOrRepository?.isPhoneRegistrationTokenRepository) {
    return dbOrRepository;
  }
  return createPhoneRegistrationTokenRepository(dbOrRepository);
}

function authRateLimitRepositoryFor(dbOrRepository) {
  if (dbOrRepository?.isAuthRateLimitRepository) {
    return dbOrRepository;
  }
  return createAuthRateLimitRepository(dbOrRepository);
}

// HMAC key for hashing phone numbers in registration tokens (derived from JWT_SECRET)
const PHONE_HMAC_KEY =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "test"
    ? "test-secret-key-32chars-minimum!!"
    : (() => {
        throw new Error("JWT_SECRET required for phone HMAC");
      })());

/**
 * Clear all rate limits (for testing only)
 * Clears both in-memory cache and DB entries for auth-keyed rate limits.
 */
async function clearRateLimits(db) {
  if (authRouteRateLimitRepository) {
    await authRouteRateLimitRepository.clearAuthLimits();
  }
  if (db) {
    await authRateLimitRepositoryFor(db).clearAuthLimits();
  }
}

/**
 * Clear all registration tokens (for testing only)
 */
async function clearRegistrationTokens(db) {
  if (db) {
    await phoneRegistrationTokenRepositoryFor(db).deleteAll();
  }
}

/**
 * Hash a phone number for storage (HMAC-SHA256, not reversible)
 */
function hashPhoneNumber(phoneNumber) {
  return crypto
    .createHmac("sha256", PHONE_HMAC_KEY)
    .update(phoneNumber)
    .digest("hex");
}

function encodePreauthCookie(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePreauthCookie(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "this email";
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Generate a DB-backed registration token for phone auth
 * @param {object} db - Database instance
 * @param {string} phoneNumber - Verified phone number
 * @param {string} ipAddress - Client IP address
 * @returns {Promise<string>} Registration token
 */
async function createRegistrationToken(dbOrRepository, phoneNumber, ipAddress) {
  const repository = phoneRegistrationTokenRepositoryFor(dbOrRepository);
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const phoneHash = hashPhoneNumber(phoneNumber);
  // Use space-separated format for SQLite compatibility (CURRENT_TIMESTAMP comparison)
  const toDbTimestamp = (d) =>
    d.toISOString().replace("T", " ").replace("Z", "");
  const now = toDbTimestamp(new Date());
  const expiresAt = toDbTimestamp(new Date(Date.now() + 15 * 60 * 1000));

  await repository.insert({
    tokenHash,
    phoneNumberHash: phoneHash,
    ipAddress: ipAddress || null,
    verifiedAt: now,
    expiresAt,
  });

  return token;
}

/**
 * Verify and consume a DB-backed registration token
 * @param {object} db - Database instance
 * @param {string} token - Registration token
 * @param {string} phoneNumber - Phone number to verify against
 * @returns {Promise<{ valid: boolean, phone_number?: string }>}
 */
async function consumeRegistrationToken(
  dbOrRepository,
  token,
  phoneNumber,
  ipAddress,
) {
  const repository = phoneRegistrationTokenRepositoryFor(dbOrRepository);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expectedHash = hashPhoneNumber(phoneNumber);

  // Atomic consume: UPDATE only if unconsumed, unexpired, phone matches, and IP matches.
  // The ip_address IS NULL fallback handles tokens created before IP-binding was added.
  // Returns the updated row count — if 0, token was already consumed or invalid.
  const result = await repository.consume({
    tokenHash,
    phoneNumberHash: expectedHash,
    ipAddress: ipAddress || null,
  });

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
async function findExistingAccountByIdentifiers(
  identityRepository,
  { email, phone, providerType, providerUserId } = {},
) {
  let matchedUserId = null;
  let matchedVia = null;

  // Check email → user_contacts (verified only)
  if (email) {
    const row = await identityRepository.findActiveUserByVerifiedContact(
      "email",
      email.toLowerCase(),
    );
    if (row) {
      matchedUserId = row.id;
      matchedVia = "email";
    }
  }

  // Check phone → user_auth_providers
  if (!matchedUserId && phone) {
    const row = await identityRepository.findActiveUserByProvider(
      "phone",
      phone,
      { status: "active" },
    );
    if (row) {
      matchedUserId = row.id;
      matchedVia = "phone";
    }
  }

  // Check social provider → user_auth_providers
  if (!matchedUserId && providerType && providerUserId) {
    const row = await identityRepository.findActiveUserByProvider(
      providerType,
      providerUserId,
    );
    if (row) {
      matchedUserId = row.id;
      matchedVia = "social";
    }
  }

  if (!matchedUserId) {
    return { exists: false };
  }

  // Fetch auth methods and profile info for the matched account
  const providerRows =
    await identityRepository.listAuthProvidersForUser(matchedUserId);
  const authMethods = providerRows.map((p) => p.provider);

  const user = await identityRepository.findUserContactMirrors(matchedUserId);

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

  return {
    exists: true,
    userId: matchedUserId,
    matchedVia,
    authMethods,
    maskedEmail,
    maskedPhone,
  };
}

/**
 * Extract client IP from request.
 * Delegates to the canonical extractor in src/utils/client-ip.js, which
 * prefers a validated CF-Connecting-IP header (Cloudflare → Railway → origin)
 * and only then falls back to Fastify's request.ip. Keeping this thin wrapper
 * preserves all existing callsites in this file.
 */
function getClientIp(request) {
  return extractClientIp(request);
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

  const accessToken = authService.generateAccessToken(userId, {
    sessionId: session.id,
  });
  const { token: refreshToken } = await authService.createRefreshToken(userId, {
    sessionId: session.id,
  });

  return { accessToken, refreshToken };
}

/**
 * Pre-handler hook to require authentication
 * Sets request.userId if valid, returns 401 error if not
 */
async function requireAuth(request, reply) {
  if (!requireAuthUser) {
    throw new Error("Auth routes have not been registered");
  }
  return requireAuthUser(request, reply);
}

/**
 * Register auth routes on Fastify app
 */
function registerAuthRoutes(
  app,
  {
    db,
    subscriptionManager,
    appConfig = {},
    etsyCodeClaimService = null,
    etsyRedemptionService = null,
  } = {},
) {
  authRouteSessionRepository = createAuthSessionRepository(db);
  const canonicalWebOrigin = String(
    appConfig.MAGIC_LOGIN_WEB_ORIGIN ||
      process.env.MAGIC_LOGIN_WEB_ORIGIN ||
      "https://porizo.co",
  ).replace(/\/$/, "");
  const allowedWebOrigins = new Set(
    (() => {
      const configured = String(
        appConfig.MAGIC_LOGIN_WEB_ALLOWED_ORIGINS ||
          process.env.MAGIC_LOGIN_WEB_ALLOWED_ORIGINS ||
          `${canonicalWebOrigin},https://auth.porizo.co`,
      )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
      return configured.length ? configured : [canonicalWebOrigin];
    })(),
  );
  allowedWebOrigins.add(canonicalWebOrigin);
  const hasAllowedWebOrigin = (request) =>
    allowedWebOrigins.has(String(request.headers.origin || ""));
  authRouteRateLimitRepository = createAuthRateLimitRepository(db);
  authRouteProfileRepository = createAuthProfileRepository(db);
  authRouteProviderLinkingRepository = createAuthProviderLinkingRepository(db);
  authRouteCredentialRepository = createAuthCredentialRepository(db);
  authRouteReceiverSessionRepository = createReceiverSessionRepository(db);
  const attributionService = new AttributionService(db);
  const identityRepository = createIdentityRepository(db);
  const magicLoginRepository = createMagicLoginRepository(db);
  const magicLoginService = createMagicLoginService({
    repository: magicLoginRepository,
  });
  emailService.configureContactDeliveryPolicy(createContactDeliveryService(db));
  const phoneRegistrationTokenRepository =
    createPhoneRegistrationTokenRepository(db);
  // Initialize services with database
  authService.initialize(db);
  gdprAuditService.initialize(db);
  smsService.initialize(db);
  requireAuthUser = createRequireUser({
    authService,
    sendError,
    missingTokenCode: "UNAUTHORIZED",
    missingTokenMessage: "Missing authorization header.",
    attachUserId: true,
  });

  async function consumeMagicTransaction(
    transaction,
    transactionRepository,
    platform,
    request,
  ) {
    if (transaction.purpose === "add_email") {
      const txSessionRepository = createAuthSessionRepository(
        transactionRepository.db,
      );
      const authorizingSession =
        transaction.authorizingSessionId &&
        (await txSessionRepository.findActiveSession({
          userId: transaction.accountId,
          sessionId: transaction.authorizingSessionId,
        }));
      if (!authorizingSession) {
        const error = new Error("MAGIC_LOGIN_AUTHORIZATION_EXPIRED");
        error.code = "MAGIC_LOGIN_AUTHORIZATION_EXPIRED";
        throw error;
      }
      const txIdentityRepository = createIdentityRepository(
        transactionRepository.db,
      );
      await identityService.linkVerifiedMagicEmail(
        txIdentityRepository,
        transaction.accountId,
        transaction.emailNormalized,
      );
      return {
        userId: transaction.accountId,
        sessionId: null,
        contactVerified: true,
      };
    }
    if (transaction.purpose !== "login") {
      throw new Error("MAGIC_LOGIN_PURPOSE_NOT_SUPPORTED");
    }

    const txDb = transactionRepository.db;
    const transactionQuery = (sql, params) => dbQuery(txDb, sql, params);
    const etsyCodeClaim = etsyCodeClaimService
      ? await etsyCodeClaimService.findPendingForTransaction(transaction.id, {
          query: transactionQuery,
        })
      : null;
    if (
      etsyCodeClaim &&
      etsyCodeClaim.email_normalized !== transaction.emailNormalized
    ) {
      throw new Error("ETSY_CODE_CLAIM_EMAIL_MISMATCH");
    }
    const txIdentityRepository = createIdentityRepository(txDb);
    let owner = await txIdentityRepository.findActiveUserByVerifiedContact(
      "email",
      transaction.emailNormalized,
    );
    let isNewUser = false;
    if (!owner) {
      const legacyOwner = await txIdentityRepository.findActiveUserByAnyContact(
        "email",
        transaction.emailNormalized,
      );
      if (legacyOwner) {
        // The email exists on an active account only as an UNVERIFIED contact.
        // Clicking the magic link proves control of the MAILBOX — never
        // ownership of whatever account someone attached that email to. An
        // attacker can plant a victim's email as an unverified contact on
        // their own account (createOrUpdateContact does not constrain which
        // emails an account may hold), so auto-adopting here is an account
        // takeover unless the account provably has no other human identity:
        // every active auth factor must be the email login for THIS exact
        // email (or the account must have no auth factor at all). Anything
        // else — an Apple/phone/google factor, or an email factor with a
        // different subject — is takeover-sensitive and requires explicit
        // recovery through one of those factors.
        const activeProviders =
          await txIdentityRepository.listActiveAuthProvidersForUser(
            legacyOwner.id,
          );
        const isSafeEmailShell = activeProviders.every(
          (row) =>
            row.provider === "email" &&
            row.provider_user_id === transaction.emailNormalized,
        );
        if (isSafeEmailShell) {
          await identityService.verifyContact(
            txIdentityRepository,
            legacyOwner.id,
            "email",
            transaction.emailNormalized,
            "magic_link",
          );
          owner = { id: legacyOwner.id };
          // isNewUser stays false — we adopted an existing account.
        } else {
          const error = new Error("LEGACY_ACCOUNT_RECOVERY_REQUIRED");
          error.code = "LEGACY_ACCOUNT_RECOVERY_REQUIRED";
          error.details = {
            masked_email: maskEmail(transaction.emailNormalized),
            auth_methods: activeProviders.map((row) => row.provider).join(","),
          };
          throw error;
        }
      } else {
        const created =
          await identityService.createUserWithIdentityInRepository(
            txIdentityRepository,
            {
              type: "email",
              subject: transaction.emailNormalized,
              verifiedAt: new Date().toISOString(),
            },
            {
              contacts: [
                {
                  type: "email",
                  value: transaction.emailNormalized,
                  source: "magic_link",
                  verified: true,
                },
              ],
            },
          );
        owner = { id: created.userId };
        isNewUser = true;
      }
    }

    // Reclaim any guest-owned paid web order placed with THIS verified email so
    // a first-time buyer who pays as a guest and later signs in actually reaches
    // their song. The paid-transition convergence only re-owns when the checkout
    // email already matched a verified account; this closes the first-time-buyer
    // gap. Runs inside the login transaction (repository.withTransaction), so a
    // failure rolls the whole login back — the magic link is un-consumed and the
    // user can retry — rather than committing a half-done merge. Only merges
    // merge-safe shells (never a real account with its own auth factor).
    await reclaimGuestOrdersOnLogin(
      (sql, params) => dbQuery(txDb, sql, params),
      {
        loginUserId: owner.id,
        emailNormalized: transaction.emailNormalized,
        identityRepository: txIdentityRepository,
      },
    );

    if (platform === "web") {
      const now = new Date();
      const webSessionToken = crypto.randomBytes(32).toString("base64url");
      const sessionId = `sess_${crypto.randomBytes(12).toString("hex")}`;
      const absoluteExpiresAt = new Date(
        now.getTime() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await createAuthSessionRepository(txDb).insertSession({
        id: sessionId,
        userId: owner.id,
        deviceName: request.headers["user-agent"],
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
        authMethod: "magic_email",
        platform: "web",
        authenticatedAt: now.toISOString(),
        idleExpiresAt: new Date(
          now.getTime() + 90 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        absoluteExpiresAt,
        lastRotatedAt: now.toISOString(),
        webSessionHash: crypto
          .createHash("sha256")
          .update(webSessionToken, "utf8")
          .digest("hex"),
      });
      if (etsyCodeClaim) {
        if (!etsyRedemptionService) {
          throw new Error("ETSY_CODE_REDEMPTION_SERVICE_REQUIRED");
        }
        await etsyRedemptionService.redeem({
          code: etsyCodeClaim.code,
          userId: owner.id,
          externalQuery: transactionQuery,
        });
        await etsyCodeClaimService.markConsumed(
          {
            claimId: etsyCodeClaim.id,
            ownerUserId: owner.id,
          },
          { query: transactionQuery },
        );
      }
      return {
        userId: owner.id,
        sessionId,
        webSessionToken,
        absoluteExpiresAt,
        isNewUser,
        identitySubject: transaction.emailNormalized,
      };
    }

    const issued = await authService.createSessionAndRefreshTokenInTransaction(
      owner.id,
      {
        platform,
        authMethod: "magic_email",
        deviceName: request.headers["user-agent"],
        userAgent: request.headers["user-agent"],
        ipAddress: getClientIp(request),
      },
      {
        sessionRepository: createAuthSessionRepository(txDb),
        refreshTokenRepository: createAuthRefreshTokenRepository(txDb),
      },
    );
    return {
      userId: owner.id,
      sessionId: issued.sessionId,
      tokenFamilyId: issued.tokenFamily,
      accessToken: authService.generateAccessToken(owner.id, {
        sessionId: issued.sessionId,
      }),
      refreshToken: issued.refreshToken,
      absoluteExpiresAt: issued.absoluteExpiresAt,
      isNewUser,
      identitySubject: transaction.emailNormalized,
    };
  }

  // ==================== PLATFORM-BOUND MAGIC LOGIN ====================

  app.post("/auth/magic/request", async (request, reply) => {
    const email = String(request.body?.email || "")
      .trim()
      .toLowerCase();
    const platform = String(request.body?.platform || "").toLowerCase();
    const purpose = String(request.body?.purpose || "login").toLowerCase();
    const requestedReturnTo = String(request.body?.return_to || "");
    const isEtsyCodeClaim =
      platform === "web" &&
      requestedReturnTo === "etsy_code" &&
      Boolean(request.body?.etsy_code);
    const returnTo =
      platform === "web" && ["etsy", "etsy_code"].includes(requestedReturnTo)
        ? requestedReturnTo
        : null;
    let requesterKey = String(request.body?.requester_key || "");
    const clientIp = getClientIp(request);
    const enabled = process.env.MAGIC_LOGIN_ENABLED !== "false";

    if (!enabled) {
      return sendError(
        reply,
        503,
        "MAGIC_LOGIN_DISABLED",
        "Email sign-in is temporarily unavailable.",
      );
    }
    if (isEtsyCodeClaim) {
      if (
        !etsyCodeClaimService ||
        !["code", "api"].includes(await getEtsyFulfilmentMode(db))
      ) {
        return sendError(reply, 404, "ETSY_ENTRY_DISABLED", "Not found.");
      }
      try {
        await etsyCodeClaimService.assertRedeemable(request.body.etsy_code);
      } catch (error) {
        const statusByCode = {
          CODE_NOT_FOUND: 404,
          CODE_ALREADY_REDEEMED: 409,
          CODE_VOID: 410,
        };
        const status = statusByCode[error?.code];
        if (status) return sendError(reply, status, error.code, error.message);
        throw error;
      }
      if (!emailService.isConfigured() && process.env.NODE_ENV !== "test") {
        return sendError(
          reply,
          503,
          "MAGIC_LOGIN_DELIVERY_UNAVAILABLE",
          "We can't send the verification email right now. Please try again shortly.",
        );
      }
    }
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !["ios", "android", "web"].includes(platform) ||
      purpose !== "login" ||
      (platform !== "web" &&
        (requesterKey.length < 16 || requesterKey.length > 512))
    ) {
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN_REQUEST",
        "Invalid request.",
      );
    }

    if (platform === "web") {
      if (request.headers.origin !== canonicalWebOrigin) {
        return sendError(
          reply,
          403,
          "INVALID_MAGIC_LOGIN_ORIGIN",
          "Invalid request.",
        );
      }
      requesterKey = crypto.randomBytes(32).toString("base64url");
    }

    const limited =
      (await consumeAuthRateLimit(
        `magic-ip:${clientIp}`,
        10,
        60 * 60 * 1000,
      )) ||
      (await consumeAuthRateLimit(`magic-email:${email}`, 5, 60 * 60 * 1000));
    if (limited) {
      return sendError(
        reply,
        429,
        "MAGIC_LOGIN_RATE_LIMITED",
        "Too many sign-in requests. Please try again later.",
      );
    }

    const now = new Date();
    const requesterKeyHash = magicLoginService.hashRequesterKey(requesterKey);
    const activeForRequester = await magicLoginRepository.countActive(
      { requesterKeyHash },
      now.toISOString(),
    );
    const activeForEmail = await magicLoginRepository.countActive(
      { emailNormalized: email, platform },
      now.toISOString(),
    );
    const recentForEmail = await magicLoginRepository.findRecentActive({
      emailNormalized: email,
      since: new Date(now.getTime() - 60_000).toISOString(),
    });
    if (activeForRequester >= 3 || activeForEmail >= 3 || recentForEmail) {
      return sendError(
        reply,
        429,
        "MAGIC_LOGIN_COOLDOWN",
        "A sign-in link was requested recently. Please wait before trying again.",
      );
    }
    const created = await magicLoginService.createTransaction({
      email,
      platform,
      purpose,
      requesterKey,
      ipAddress: clientIp,
    });
    if (isEtsyCodeClaim) {
      try {
        await etsyCodeClaimService.createPending({
          code: request.body.etsy_code,
          email,
          magicTransactionId: created.transactionId,
          expiresAt: created.expiresAt,
        });
      } catch (error) {
        await magicLoginRepository.expirePendingById({
          id: created.transactionId,
          expiredAt: new Date().toISOString(),
        });
        const status = error?.code === "CODE_CLAIM_PENDING" ? 409 : 400;
        return sendError(
          reply,
          status,
          error?.code || "ETSY_CODE_CLAIM_FAILED",
          error?.message || "We couldn't protect this code.",
        );
      }
    }
    if (emailService.isConfigured()) {
      const delivery = emailService.sendMagicLoginEmail(email, {
        webOrigin: canonicalWebOrigin,
        transactionId: created.transactionId,
        platform,
        linkSecret: created.linkSecret,
        expiresAt: created.expiresAt,
      });
      if (isEtsyCodeClaim) {
        try {
          await delivery;
        } catch (error) {
          const expiredAt = new Date().toISOString();
          await Promise.all([
            magicLoginRepository.expirePendingById({
              id: created.transactionId,
              expiredAt,
            }),
            etsyCodeClaimService.expirePendingForTransaction(
              created.transactionId,
            ),
          ]);
          app.log.error(
            { err: error, transactionId: created.transactionId, platform },
            "Etsy code verification email failed",
          );
          return sendError(
            reply,
            503,
            "MAGIC_LOGIN_DELIVERY_FAILED",
            "We couldn't send the verification email. Please try again.",
          );
        }
      } else {
        delivery.catch((error) =>
          app.log.error(
            { err: error, transactionId: created.transactionId, platform },
            "Magic login email failed",
          ),
        );
      }
    }

    reply.header("Cache-Control", "no-store");
    if (platform === "web") {
      if (isEtsyCodeClaim) {
        return reply.code(202).send({
          accepted: true,
          transaction_id: created.transactionId,
          expires_at: created.expiresAt,
        });
      }
      reply.header("Set-Cookie", [
        `__Host-porizo_preauth=${encodePreauthCookie({ transactionId: created.transactionId, requestSecret: created.requestSecret, returnTo })}; Max-Age=900; Path=/; Secure; HttpOnly; SameSite=Lax`,
        `__Host-porizo_csrf=${encodeURIComponent(requesterKey)}; Max-Age=900; Path=/; Secure; SameSite=Lax`,
      ]);
      return reply.code(202).send({
        accepted: true,
        transaction_id: created.transactionId,
        expires_at: created.expiresAt,
      });
    }
    return reply.code(202).send({
      accepted: true,
      transaction_id: created.transactionId,
      request_secret: created.requestSecret,
      expires_at: created.expiresAt,
    });
  });

  app.post(
    "/auth/magic/add-email/request",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (
        !(await authService.verifyRecentAuthentication({
          userId: request.userId,
          sessionId: request.sessionId,
        }))
      ) {
        return sendError(
          reply,
          401,
          "RECENT_AUTHENTICATION_REQUIRED",
          "Please sign in again before changing your email.",
        );
      }
      const email = String(request.body?.email || "")
        .trim()
        .toLowerCase();
      const platform = String(request.body?.platform || "").toLowerCase();
      const requesterKey = String(request.body?.requester_key || "");
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !["ios", "android"].includes(platform) ||
        requesterKey.length < 16 ||
        requesterKey.length > 512
      ) {
        return sendError(
          reply,
          400,
          "INVALID_MAGIC_LOGIN_REQUEST",
          "Invalid request.",
        );
      }
      const activeForAccount = await magicLoginRepository.countActive(
        { accountId: request.userId, platform },
        new Date().toISOString(),
      );
      if (activeForAccount >= 3) {
        return sendError(
          reply,
          429,
          "MAGIC_LOGIN_COOLDOWN",
          "Too many email changes are pending. Please try again later.",
        );
      }
      if (
        await consumeAuthRateLimit(
          `magic-add-email:${request.userId}`,
          5,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "MAGIC_LOGIN_RATE_LIMITED",
          "Too many email-change requests. Please try again later.",
        );
      }
      const created = await magicLoginService.createTransaction({
        email,
        platform,
        purpose: "add_email",
        requesterKey,
        ipAddress: getClientIp(request),
        accountId: request.userId,
        authorizingSessionId: request.sessionId,
      });
      if (emailService.isConfigured()) {
        emailService
          .sendMagicLoginEmail(email, {
            webOrigin: canonicalWebOrigin,
            transactionId: created.transactionId,
            platform,
            linkSecret: created.linkSecret,
            expiresAt: created.expiresAt,
          })
          .catch((error) =>
            app.log.error(
              { err: error, transactionId: created.transactionId, platform },
              "Magic add-email message failed",
            ),
          );
      }
      reply.header("Cache-Control", "no-store");
      return reply.code(202).send({
        accepted: true,
        transaction_id: created.transactionId,
        request_secret: created.requestSecret,
        expires_at: created.expiresAt,
      });
    },
  );

  app.get("/auth/magic/:platform", async (request, reply) => {
    reply.header("Cache-Control", "no-store, max-age=0");
    reply.header("Pragma", "no-cache");
    reply.header("Referrer-Policy", "no-referrer");
    const platform = String(request.params?.platform || "").toLowerCase();
    if (!["ios", "android", "web"].includes(platform)) {
      return reply.code(404).type("text/plain").send("Not found");
    }
    if (platform === "web") {
      const cookies = parseCookieHeader(request.headers.cookie);
      const preauth = decodePreauthCookie(cookies["__Host-porizo_preauth"]);
      const transactionId = String(request.query?.transaction_id || "");
      const etsyCodeClaim = etsyCodeClaimService
        ? await etsyCodeClaimService.findPendingForTransaction(transactionId)
        : null;
      if (etsyCodeClaim) {
        const nonce = crypto.randomBytes(16).toString("base64");
        reply.header(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
        );
        return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Protecting your Etsy song</title>
<style>body{font:17px system-ui;margin:0;padding:32px;color:#211d1a;background:#fffaf6}main{max-width:560px;margin:10vh auto}button{display:block;width:100%;margin:20px 0;padding:16px;border:0;border-radius:12px;background:#e7784d;color:#211d1a;font:inherit;font-weight:700}</style>
<body><main><h1>Protect your paid song</h1>
<p id="status" role="status" aria-live="polite">Confirm this email to add the song credit to your Porizo account.</p>
<button id="confirm" type="button">Confirm and continue</button></main>
<script nonce="${nonce}">
(function () {
  const status = document.getElementById('status');
  const confirm = document.getElementById('confirm');
  const transactionId = new URL(location.href).searchParams.get('transaction_id');
  const secret = new URLSearchParams(location.hash.slice(1)).get('secret');
  history.replaceState(null, '', location.pathname + (transactionId ? '?transaction_id=' + encodeURIComponent(transactionId) : ''));
  if (!transactionId || !secret) { confirm.disabled = true; status.textContent = 'This verification link is invalid.'; return; }
  confirm.addEventListener('click', async function (event) {
    if (!event.isTrusted) return;
    confirm.disabled = true; status.textContent = 'Protecting your song…';
    try {
      const response = await fetch('/auth/magic/etsy-code/exchange', {
        method: 'POST', credentials: 'same-origin', headers: {'content-type':'application/json'},
        body: JSON.stringify({transaction_id: transactionId, link_secret: secret})
      });
      if (!response.ok) throw new Error('exchange failed');
      status.textContent = 'Your song credit is ready. Redirecting…';
      sessionStorage.setItem('porizo.etsy-fulfilment', crypto.randomUUID());
      localStorage.removeItem('porizo.web-funnel.order-recovery.v1');
      localStorage.removeItem('porizo.web-funnel.v1');
      location.replace('/create');
    } catch (_) { confirm.disabled = false; status.textContent = 'This link is invalid or expired. Return to the code page and try again.'; }
  });
})();
</script></body></html>`);
      }
      const returnPath =
        preauth?.transactionId === transactionId && preauth?.returnTo === "etsy"
          ? "/etsy"
          : "/create";
      const nonce = crypto.randomBytes(16).toString("base64");
      reply.header(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
      );
      return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing in to Porizo</title><body><main><h1>Signing you in</h1>
<p id="status" role="status" aria-live="polite">Checking this secure link…</p></main>
<script nonce="${nonce}">
(async function () {
  const status = document.getElementById('status');
  const transactionId = new URL(location.href).searchParams.get('transaction_id');
  const secret = new URLSearchParams(location.hash.slice(1)).get('secret');
  const csrf = document.cookie.split('; ').find(v => v.startsWith('__Host-porizo_csrf='))?.split('=').slice(1).join('=');
  if (!transactionId || !secret || !csrf) { status.textContent = 'This sign-in link is invalid or was opened in a different browser.'; return; }
  history.replaceState(null, '', location.pathname + '?transaction_id=' + encodeURIComponent(transactionId));
  try {
    const response = await fetch('/auth/magic/exchange', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: transactionId, platform: 'web', link_secret: secret, csrf: decodeURIComponent(csrf) })
    });
    if (!response.ok) throw new Error('exchange failed');
    status.textContent = 'Signed in. Redirecting…';
    location.replace(${JSON.stringify(returnPath)});
  } catch { status.textContent = 'This sign-in link is invalid, expired, or was opened in a different browser.'; }
})();
</script></body></html>`);
    }
    const browserApprovalEnabled =
      process.env.MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED !== "false";
    const nonce = crypto.randomBytes(16).toString("base64");
    reply.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
    );
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Continue sign-in to Porizo</title>
<style>body{font:17px system-ui;margin:0;padding:32px;color:#211d1a;background:#fffaf6}main{max-width:560px;margin:10vh auto}button,a{display:block;box-sizing:border-box;width:100%;margin:16px 0;padding:16px;border:0;border-radius:12px;text-align:center;font:inherit;text-decoration:none}button{background:#e7784d;color:white}a{background:#eee;color:#211d1a}.hidden{display:none}</style>
<body><main><h1>Continue sign-in to Porizo</h1>
<p id="status" role="status" aria-live="polite">${
      browserApprovalEnabled
        ? `Confirm this email link, then return to the ${platform === "ios" ? "iPhone" : "Android"} device that requested it.`
        : `Open the original email on the ${platform === "ios" ? "iPhone" : "Android"} device that requested this link, then choose Open in Porizo. Browser confirmation is temporarily unavailable.`
    }</p>
${browserApprovalEnabled ? '<button id="approve" type="button">Continue sign-in</button>' : ""}
<a id="open" class="hidden" href="#">Open Porizo</a>
<a href="${platform === "ios" ? "https://apps.apple.com/app/id6758205028" : "https://play.google.com/store/apps/details?id=com.porizo.app"}">Get Porizo</a>
</main><script nonce="${nonce}">
(function () {
  const status = document.getElementById('status');
  const approve = document.getElementById('approve');
  const open = document.getElementById('open');
  const transactionId = new URL(location.href).searchParams.get('transaction_id');
  const secret = new URLSearchParams(location.hash.slice(1)).get('secret');
  history.replaceState(null, '', location.pathname + (transactionId ? '?transaction_id=' + encodeURIComponent(transactionId) : ''));
  if (!approve) return;
  if (!transactionId || !secret) { approve.disabled = true; status.textContent = 'This sign-in link is invalid.'; return; }
  approve.addEventListener('click', async function (event) {
    if (!event.isTrusted) return;
    approve.disabled = true; status.textContent = 'Confirming your email…';
    try {
      const response = await fetch('/auth/magic/native/approve', {
        method: 'POST', credentials: 'same-origin', headers: {'content-type':'application/json'},
        body: JSON.stringify({transaction_id: transactionId, platform: '${platform}', link_secret: secret})
      });
      if (!response.ok) throw new Error('approval failed');
      status.textContent = 'Email confirmed. Open Porizo on the device that requested this link.';
      approve.className = 'hidden';
      open.href = 'porizo://auth/magic/resume?transaction_id=' + encodeURIComponent(transactionId);
      open.className = '';
    } catch (_) { approve.disabled = false; status.textContent = 'This link is invalid or expired. Request a new one in Porizo.'; }
  });
})();
</script></body></html>`);
  });

  app.post("/auth/magic/native/approve", async (request, reply) => {
    if (process.env.MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED === "false") {
      return sendError(
        reply,
        503,
        "MAGIC_LOGIN_BROWSER_APPROVAL_DISABLED",
        "Browser confirmation is unavailable.",
      );
    }
    if (!hasAllowedWebOrigin(request)) {
      return sendError(
        reply,
        403,
        "INVALID_MAGIC_LOGIN_ORIGIN",
        "Invalid request.",
      );
    }
    const result = await magicLoginService.approve({
      transactionId: String(request.body?.transaction_id || ""),
      platform: String(request.body?.platform || "").toLowerCase(),
      linkSecret: String(request.body?.link_secret || ""),
    });
    reply.header("Cache-Control", "no-store");
    if (result.status !== "approved") {
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN",
        "Invalid or expired sign-in link.",
      );
    }
    return reply.send({ status: "approved" });
  });

  app.post("/auth/magic/etsy-code/exchange", async (request, reply) => {
    if (!hasAllowedWebOrigin(request)) {
      return sendError(reply, 403, "INVALID_MAGIC_LOGIN_ORIGIN", "Invalid request.");
    }
    const transactionId = String(request.body?.transaction_id || "");
    try {
      const exchanged = await magicLoginService.exchangeAuthorizedClaim({
        transactionId,
        platform: "web",
        linkSecret: String(request.body?.link_secret || ""),
        authorize: async (transaction, transactionRepository) => {
          const claim = await etsyCodeClaimService?.findPendingForTransaction(
            transaction.id,
            {
              query: (sql, params) =>
                dbQuery(transactionRepository.db, sql, params),
            },
          );
          return (
            claim?.email_normalized === transaction.emailNormalized &&
            ["code", "api"].includes(await getEtsyFulfilmentMode(db))
          );
        },
        consume: (transaction, transactionRepository) =>
          consumeMagicTransaction(
            transaction,
            transactionRepository,
            "web",
            request,
          ),
      });
      if (exchanged.status !== "consumed") {
        return sendError(
          reply,
          400,
          "INVALID_MAGIC_LOGIN",
          "Invalid or expired verification link.",
        );
      }
      if (exchanged.result.isNewUser) {
        try {
          await subscriptionManager.createFreeEntitlements(
            exchanged.result.userId,
            {
              identity: {
                provider: "email",
                subject: exchanged.result.identitySubject,
              },
            },
          );
        } catch (error) {
          app.log.error(
            { err: error, userId: exchanged.result.userId },
            "Free entitlements were not initialized after Etsy claim",
          );
        }
      }
      const webCsrf = crypto.randomBytes(24).toString("base64url");
      reply.header("Cache-Control", "no-store");
      reply.header("Set-Cookie", [
        `__Host-porizo_session=${encodeURIComponent(exchanged.result.webSessionToken)}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Strict`,
        `__Host-porizo_web_csrf=${encodeURIComponent(webCsrf)}; Max-Age=31536000; Path=/; Secure; SameSite=Strict`,
      ]);
      return reply.send({
        authenticated: true,
        user_id: exchanged.result.userId,
        etsy_code_redeemed: true,
      });
    } catch (error) {
      app.log.warn(
        { transactionId, code: error?.code || error?.message },
        "Etsy code verification rejected",
      );
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN",
        "Invalid or expired verification link.",
      );
    }
  });

  app.post("/auth/magic/native/status", async (request, reply) => {
    const result = await magicLoginService.status({
      transactionId: String(request.body?.transaction_id || ""),
      platform: String(request.body?.platform || "").toLowerCase(),
      requestSecret: String(request.body?.request_secret || ""),
    });
    reply.header("Cache-Control", "no-store");
    if (result.status === "invalid") {
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN",
        "Invalid or expired sign-in link.",
      );
    }
    return reply.send({ status: result.status, expires_at: result.expiresAt });
  });

  app.post("/auth/magic/native/complete", async (request, reply) => {
    const transactionId = String(request.body?.transaction_id || "");
    const platform = String(request.body?.platform || "").toLowerCase();
    try {
      const completed = await magicLoginService.completeApproved({
        transactionId,
        platform,
        requestSecret: String(request.body?.request_secret || ""),
        consume: (transaction, transactionRepository) =>
          consumeMagicTransaction(
            transaction,
            transactionRepository,
            platform,
            request,
          ),
      });
      if (!["consumed", "recovered"].includes(completed.status)) {
        return sendError(
          reply,
          400,
          "INVALID_MAGIC_LOGIN",
          "Invalid or expired sign-in link.",
        );
      }
      if (completed.result.isNewUser) {
        await subscriptionManager.createFreeEntitlements(
          completed.result.userId,
          {
            identity: {
              provider: "email",
              subject: completed.result.identitySubject,
            },
          },
        );
      }
      reply.header("Cache-Control", "no-store");
      if (completed.result.contactVerified) {
        return reply.send({
          user_id: completed.result.userId,
          contact_verified: true,
        });
      }
      return reply.send({
        user_id: completed.result.userId,
        access_token: completed.result.accessToken,
        refresh_token: completed.result.refreshToken,
        expires_in: 900,
        session_expires_at: completed.result.absoluteExpiresAt,
        is_new_user: Boolean(completed.result.isNewUser),
      });
    } catch (error) {
      app.log.warn(
        { transactionId, platform, code: error.code || error.message },
        "Magic login completion rejected",
      );
      if (error.code === "LEGACY_ACCOUNT_RECOVERY_REQUIRED") {
        return reply.code(409).send({
          error: error.code,
          message: "Recover the existing account before using this email.",
          details: error.details,
        });
      }
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN",
        "Invalid or expired sign-in link.",
      );
    }
  });

  app.post("/auth/magic/exchange", async (request, reply) => {
    const transactionId = String(request.body?.transaction_id || "");
    const platform = String(request.body?.platform || "").toLowerCase();
    const linkSecret = String(request.body?.link_secret || "");
    let requestSecret = String(request.body?.request_secret || "");
    if (!["ios", "android", "web"].includes(platform)) {
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN",
        "Invalid or expired sign-in link.",
      );
    }

    if (platform === "web") {
      const cookies = parseCookieHeader(request.headers.cookie);
      const preauth = decodePreauthCookie(cookies["__Host-porizo_preauth"]);
      const csrf = String(request.body?.csrf || "");
      const transaction = await magicLoginRepository.findById(transactionId);
      if (
        !hasAllowedWebOrigin(request) ||
        !preauth ||
        preauth.transactionId !== transactionId ||
        !csrf ||
        csrf !== cookies["__Host-porizo_csrf"] ||
        !transaction ||
        magicLoginService.hashRequesterKey(csrf) !==
          transaction.requesterKeyHash
      ) {
        return sendError(
          reply,
          400,
          "INVALID_MAGIC_LOGIN",
          "Invalid or expired sign-in link.",
        );
      }
      requestSecret = preauth.requestSecret;
    }

    try {
      const exchanged = await magicLoginService.exchange({
        transactionId,
        platform,
        linkSecret,
        requestSecret,
        consume: (transaction, transactionRepository) =>
          consumeMagicTransaction(
            transaction,
            transactionRepository,
            platform,
            request,
          ),
      });

      if (!["consumed", "recovered"].includes(exchanged.status)) {
        return sendError(
          reply,
          400,
          "INVALID_MAGIC_LOGIN",
          "Invalid or expired sign-in link.",
        );
      }
      if (exchanged.result.isNewUser) {
        await subscriptionManager.createFreeEntitlements(
          exchanged.result.userId,
          {
            identity: {
              provider: "email",
              subject: exchanged.result.identitySubject,
            },
          },
        );
      }
      reply.header("Cache-Control", "no-store");
      if (platform === "web") {
        const webCsrf = crypto.randomBytes(24).toString("base64url");
        reply.header("Set-Cookie", [
          `__Host-porizo_session=${encodeURIComponent(exchanged.result.webSessionToken)}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Strict`,
          `__Host-porizo_web_csrf=${encodeURIComponent(webCsrf)}; Max-Age=31536000; Path=/; Secure; SameSite=Strict`,
          "__Host-porizo_preauth=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
          "__Host-porizo_csrf=; Max-Age=0; Path=/; Secure; SameSite=Lax",
        ]);
        return reply.send({
          user_id: exchanged.result.userId,
          authenticated: true,
        });
      }
      if (exchanged.result.contactVerified) {
        return reply.send({
          user_id: exchanged.result.userId,
          contact_verified: true,
        });
      }
      return reply.send({
        user_id: exchanged.result.userId,
        access_token: exchanged.result.accessToken,
        refresh_token: exchanged.result.refreshToken,
        expires_in: 900,
        session_expires_at: exchanged.result.absoluteExpiresAt,
        is_new_user: Boolean(exchanged.result.isNewUser),
      });
    } catch (error) {
      app.log.warn(
        { transactionId, platform, code: error.code || error.message },
        "Magic login exchange rejected",
      );
      if (error.code === "LEGACY_ACCOUNT_RECOVERY_REQUIRED") {
        return reply.code(409).send({
          error: error.code,
          message: "Recover the existing account before using this email.",
          details: error.details,
        });
      }
      return sendError(
        reply,
        400,
        "INVALID_MAGIC_LOGIN",
        "Invalid or expired sign-in link.",
      );
    }
  });

  app.get("/auth/web/session", async (request, reply) => {
    const token = parseCookieHeader(request.headers.cookie)[
      "__Host-porizo_session"
    ];
    if (!token) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Authentication required.");
    }
    const session = await authRouteSessionRepository.findActiveWebSession(
      crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    );
    if (!session) {
      return sendError(
        reply,
        401,
        "INVALID_SESSION",
        "Invalid or expired session.",
      );
    }
    const now = new Date();
    const absoluteExpiry = new Date(session.absolute_expires_at).getTime();
    await authRouteSessionRepository.touchWebSession({
      sessionId: session.id,
      lastActiveAt: now.toISOString(),
      idleExpiresAt: new Date(
        Math.min(now.getTime() + 90 * 24 * 60 * 60 * 1000, absoluteExpiry),
      ).toISOString(),
    });
    reply.header("Cache-Control", "no-store");
    return reply.send({ authenticated: true, user_id: session.user_id });
  });

  app.post("/auth/web/token", async (request, reply) => {
    if (!hasAllowedWebOrigin(request)) {
      return sendError(reply, 403, "INVALID_ORIGIN", "Invalid request.");
    }
    const cookies = parseCookieHeader(request.headers.cookie);
    const csrfCookie = cookies["__Host-porizo_web_csrf"];
    const csrfHeader = String(request.headers["x-csrf-token"] || "");
    if (
      !csrfCookie ||
      !csrfHeader ||
      csrfCookie.length !== csrfHeader.length ||
      !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader))
    ) {
      return sendError(reply, 403, "INVALID_CSRF", "Invalid request.");
    }
    const token = cookies["__Host-porizo_session"];
    if (!token) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Authentication required.");
    }
    const session = await authRouteSessionRepository.findActiveWebSession(
      crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    );
    if (!session) {
      return sendError(
        reply,
        401,
        "INVALID_SESSION",
        "Invalid or expired session.",
      );
    }
    const now = new Date();
    const absoluteExpiry = new Date(session.absolute_expires_at).getTime();
    await authRouteSessionRepository.touchWebSession({
      sessionId: session.id,
      lastActiveAt: now.toISOString(),
      idleExpiresAt: new Date(
        Math.min(now.getTime() + 90 * 24 * 60 * 60 * 1000, absoluteExpiry),
      ).toISOString(),
    });
    reply.header("Cache-Control", "no-store");
    return reply.send({
      access_token: authService.generateAccessToken(session.user_id, {
        sessionId: session.id,
      }),
      expires_in: 900,
    });
  });

  app.delete("/auth/web/session", async (request, reply) => {
    if (!hasAllowedWebOrigin(request)) {
      return sendError(reply, 403, "INVALID_ORIGIN", "Invalid request.");
    }
    const token = parseCookieHeader(request.headers.cookie)[
      "__Host-porizo_session"
    ];
    if (token) {
      const session = await authRouteSessionRepository.findActiveWebSession(
        crypto.createHash("sha256").update(token, "utf8").digest("hex"),
      );
      if (session) await authRouteSessionRepository.revokeSession(session.id);
    }
    reply.header("Set-Cookie", [
      "__Host-porizo_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict",
      "__Host-porizo_web_csrf=; Max-Age=0; Path=/; Secure; SameSite=Strict",
    ]);
    return reply.code(204).send();
  });

  // Clean up expired registration tokens periodically (every 6 hours)
  const tokenCleanupInterval = setInterval(
    async () => {
      try {
        await phoneRegistrationTokenRepository.deleteExpired();
      } catch {
        /* non-critical cleanup */
      }
    },
    6 * 60 * 60 * 1000,
  );
  tokenCleanupInterval.unref();

  // Clean up expired rate limit entries periodically (every 30 minutes)
  // Cleans both in-memory cache and stale DB rows for auth-keyed entries
  const rateLimitCleanupInterval = setInterval(
    async () => {
      const cutoff = Date.now() - 60 * 60 * 1000;
      await authRouteRateLimitRepository.cleanupExpiredAuthEntries(cutoff);
    },
    30 * 60 * 1000,
  );
  rateLimitCleanupInterval.unref();

  /**
   * DB-backed rate limiting for auth endpoints.
   * Uses the existing rate_limits table with sliding window, same algorithm as server.js consumeRateLimit.
   * In-memory Map serves as fast-path cache; DB is authoritative and survives restarts.
   * @param {string} key - Rate limit key (e.g., "signup:192.168.1.1")
   * @param {number} limit - Maximum requests in window
   * @param {number} windowMs - Time window in milliseconds
   * @param {{ failClosed?: boolean }} [options] - When failClosed is true, a DB
   *   error returns true (treat as rate-limited) instead of falling through to
   *   the permissive in-memory result. Use for login/signup so a DB outage can't
   *   silently disable throttling on credential-bearing endpoints. Defaults to
   *   fail-open (the historical behavior) for everything else.
   * @returns {Promise<boolean>} - true if rate limited
   */
  async function consumeAuthRateLimit(key, limit, windowMs, options = {}) {
    return authRouteRateLimitRepository.consume({
      key,
      limit,
      windowMs,
      failClosed: options.failClosed === true,
    });
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
      const recentVerification =
        await phoneRegistrationTokenRepository.findRecentVerification({
          phoneNumberHash: phoneHash,
          verifiedAfter: cutoff,
          ipAddress: clientIp,
        });

      if (!recentVerification) {
        return; // No recent verification from this IP — skip
      }

      // Check if phone is already linked to another account
      const existingLink =
        await authRouteProviderLinkingRepository.findAnyProviderLink(
          "phone",
          phoneNumber,
        );

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
        metadata: {
          provider: "phone",
          linked_via: "pending_phone_link",
          phone_masked:
            phoneNumber.slice(0, 4) + "****" + phoneNumber.slice(-2),
        },
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
      await attributionService.matchRecentDownloadEventForUser(
        userId,
        clientIp,
      );
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
      const now = new Date().toISOString();
      await authRouteReceiverSessionRepository.matchRecentUnmatchedSessionByIp({
        userId,
        clientIp,
        cutoff,
        now,
      });
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
    const countryCode = registrationCountry({
      explicitCountry: country,
      clientIp,
    });

    // Rate limit: 5/hour per IP. fail-closed so a DB outage can't silently
    // disable signup throttling.
    if (
      await consumeAuthRateLimit(`signup:${clientIp}`, 5, 60 * 60 * 1000, {
        failClosed: true,
      })
    ) {
      reply.header("Retry-After", String(60 * 60));
      return sendError(
        reply,
        429,
        "RATE_LIMITED",
        "Too many signup attempts. Please try again later.",
      );
    }

    try {
      // Check if email already exists with a verified contact (exclude soft-deleted and unverified claims)
      // Unverified emails from phone registration don't block legitimate email/password signup
      const existing = await identityRepository.findActiveUserByVerifiedContact(
        "email",
        email.toLowerCase(),
      );
      if (existing) {
        return sendError(
          reply,
          409,
          "EMAIL_EXISTS",
          "An account with this email already exists.",
        );
      }

      // Prepare password hash before transaction (async bcrypt must happen outside)
      const now = new Date().toISOString();
      const passwordHash = await authService.hashPassword(password);

      // Create user + email identity + email contact via identity service
      const { userId } = await identityService.createUserWithIdentity(
        db,
        {
          type: "email",
          subject: identityService.normalizeEmail(email),
          verifiedAt: null,
        },
        {
          contacts: [
            {
              type: "email",
              value: email,
              source: "user_entered",
              verified: false,
            },
          ],
          profile: {
            displayName: name || null,
            locale: locale || null,
            country: countryCode,
          },
        },
      );

      // Store password credential + entitlements — compensate on failure to avoid orphaned user
      try {
        await authRouteCredentialRepository.createPasswordCredential({
          userId,
          passwordHash,
          createdAt: now,
        });

        await subscriptionManager.createFreeEntitlements(userId, {
          now,
          identity: {
            provider: "email",
            subject: identityService.normalizeEmail(email),
          },
        });
      } catch (err) {
        console.error(
          "[EmailSignup] Post-creation failed, cleaning up orphaned user:",
          err.message,
        );
        await identityRepository.deleteUserIdentityBootstrapRows(userId);
        throw err;
      }

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(
        userId,
        request,
        clientIp,
      );

      // Attribution matching (non-blocking)
      matchDownloadAttribution(userId, clientIp).catch(() => {});
      matchReceiverAttribution(userId, clientIp).catch(() => {});

      // Send verification email (don't await - fire and forget)
      if (emailService.isConfigured()) {
        authService
          .createEmailVerificationToken(userId, { email: email.toLowerCase() })
          .then(({ token }) => {
            emailService.sendVerificationEmail(email, token).catch((err) => {
              console.error("Failed to send verification email:", err.message);
            });
          });
      }

      // Log account-created signal (distinct from login_success)
      await authService.logAuthEvent({
        userId,
        eventType: "signup_success",
        ipAddress: clientIp,
        userAgent: request.headers["user-agent"],
        metadata: { method: "email" },
      });

      return reply.status(201).send({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900,
      });
    } catch (error) {
      // Duplicate email IDENTITY: the pre-check above only blocks VERIFIED email
      // contacts (so an unverified email from phone registration doesn't block a
      // real email/password signup). But user_auth_providers has a UNIQUE index
      // on (provider, provider_user_id), so a second email/password signup with
      // the same address trips the constraint here. Surface that as a clean 409
      // EMAIL_EXISTS rather than a 500. Matched narrowly on the unique-violation
      // signatures (PG 23505 / SQLite 2067 / "UNIQUE constraint failed") so other
      // failures still return 500.
      const isUniqueViolation =
        error?.code === "23505" ||
        error?.errcode === 2067 ||
        /UNIQUE constraint failed/i.test(error?.message || "");
      if (isUniqueViolation) {
        return sendError(
          reply,
          409,
          "EMAIL_EXISTS",
          "An account with this email already exists.",
        );
      }
      console.error("Signup error:", error);
      return sendError(
        reply,
        500,
        "SIGNUP_FAILED",
        "Failed to create account. Please try again.",
      );
    }
  });

  // ==================== LOGIN ====================

  app.post("/auth/login", { schema: loginSchema }, async (request, reply) => {
    const { email, password } = request.body;
    const clientIp = getClientIp(request);
    const normalizedEmail = email.toLowerCase();

    // Rate limit: 10/hour per ip:email combination (prevents credential
    // stuffing across accounts). fail-closed so a DB outage can't silently
    // disable login throttling.
    if (
      await consumeAuthRateLimit(
        `login:${clientIp}:${normalizedEmail}`,
        10,
        60 * 60 * 1000,
        { failClosed: true },
      )
    ) {
      reply.header("Retry-After", String(60 * 60));
      return sendError(
        reply,
        429,
        "RATE_LIMITED",
        "Too many login attempts. Please try again later.",
      );
    }

    try {
      // Find user via identity service (email identity in user_auth_providers)
      const resolved = await identityService.resolveUserByIdentity(
        db,
        "email",
        normalizedEmail,
      );
      const user = resolved ? { id: resolved.userId } : null;

      // Constant-time dummy hash used to equalize bcrypt timing across every
      // branch (unknown user, locked account, wrong password).
      const dummyHash =
        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.IHhNFkDXgLqWKu";

      // Check account lock server-side, but do NOT distinguish it to the client:
      // return the same 401 INVALID_CREDENTIALS (not 403 ACCOUNT_LOCKED) so the
      // status code can't be used to enumerate which accounts exist / are locked.
      // Still run a bcrypt.compare so the locked path doesn't return faster than
      // the wrong-password path (kills the fast-path timing oracle).
      if (user) {
        const isLocked = await authService.isAccountLocked(user.id);
        if (isLocked) {
          await authService.verifyPassword(password, dummyHash);
          await authService.logAuthEvent({
            userId: user.id,
            eventType: "account_locked",
            ipAddress: clientIp,
            metadata: { reason: "login_attempt_while_locked" },
          });
          return sendError(
            reply,
            401,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
          );
        }
      }

      // Use constant-time verification even if user doesn't exist
      const credentials = user
        ? await authRouteCredentialRepository.findPasswordCredential(user.id)
        : null;
      const isValid = await authService.verifyPassword(
        password,
        credentials?.password_hash || dummyHash,
      );

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
          const maskedEmail =
            normalizedEmail.slice(0, 2) +
            "***@" +
            (normalizedEmail.split("@")[1] || "");
          await authService.logAuthEvent({
            eventType: "login_failed",
            ipAddress: clientIp,
            metadata: { email: maskedEmail, reason: "user_not_found" },
          });
        }

        return sendError(
          reply,
          401,
          "INVALID_CREDENTIALS",
          "Invalid email or password.",
        );
      }

      // Reset failed login count on success
      await authService.resetFailedLoginCount(user.id);

      // Create session and tokens
      const { accessToken, refreshToken } = await createSessionAndTokens(
        user.id,
        request,
        clientIp,
      );

      // Auto-link pending phone if present (from cross-identifier flow)
      if (request.body.pending_phone_link) {
        tryAutoLinkPhone(
          user.id,
          request.body.pending_phone_link,
          clientIp,
        ).catch(() => {});
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
        expires_in: 900,
      });
    } catch (error) {
      console.error("Login error:", error);
      return sendError(
        reply,
        500,
        "LOGIN_FAILED",
        "Login failed. Please try again.",
      );
    }
  });

  // ==================== SOCIAL AUTH ====================

  app.post(
    "/auth/social",
    { schema: socialAuthSchema },
    async (request, reply) => {
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
      const countryCode = registrationCountry({
        explicitCountry: country,
        clientIp,
      });

      // Rate limit: 20/hour per IP
      if (
        await consumeAuthRateLimit(`social:${clientIp}`, 20, 60 * 60 * 1000)
      ) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Too many authentication attempts. Please try again later.",
        );
      }

      try {
        // Check if provider is supported and configured
        if (!isProviderConfigured(provider)) {
          return sendError(
            reply,
            501,
            "PROVIDER_NOT_CONFIGURED",
            `${provider} authentication is not configured.`,
          );
        }

        const hasIdToken = typeof id_token === "string" && id_token.trim();
        const hasAccessToken =
          typeof access_token === "string" && access_token.trim();
        const hasAuthCode =
          typeof authorization_code === "string" && authorization_code.trim();

        if (provider === "apple" && (!nonce || !String(nonce).trim())) {
          return sendError(
            reply,
            400,
            "NONCE_REQUIRED",
            "Apple Sign-In requires a nonce. Please try again.",
          );
        }

        if (provider === "apple" && !hasIdToken) {
          return sendError(
            reply,
            400,
            "TOKEN_REQUIRED",
            "Apple Sign-In requires an ID token.",
          );
        }

        if (provider === "google" && !hasIdToken && !hasAuthCode) {
          return sendError(
            reply,
            400,
            "TOKEN_REQUIRED",
            "Google Sign-In requires an ID token or authorization code.",
          );
        }

        if (provider === "facebook" && !hasAccessToken && !hasAuthCode) {
          return sendError(
            reply,
            400,
            "TOKEN_REQUIRED",
            "Facebook Sign-In requires an access token or authorization code.",
          );
        }

        let resolvedIdToken = hasIdToken ? id_token : null;
        let resolvedAccessToken = hasAccessToken ? access_token : null;

        if (provider === "google" && !resolvedIdToken && hasAuthCode) {
          try {
            const exchange = await exchangeGoogleAuthorizationCode(
              authorization_code,
              {
                codeVerifier: code_verifier,
                redirectUri: redirect_uri,
              },
            );
            resolvedIdToken = exchange.id_token;
          } catch (exchangeError) {
            console.error(
              "[SocialAuth] Google code exchange failed:",
              exchangeError.message,
            );
            return sendError(
              reply,
              401,
              "TOKEN_EXCHANGE_FAILED",
              "Google authorization code exchange failed.",
            );
          }
        }

        if (provider === "google" && !resolvedIdToken) {
          return sendError(
            reply,
            400,
            "TOKEN_REQUIRED",
            "Google Sign-In requires an ID token.",
          );
        }

        if (provider === "facebook" && !resolvedAccessToken && hasAuthCode) {
          try {
            const exchange = await exchangeFacebookAuthorizationCode(
              authorization_code,
              {
                redirectUri: redirect_uri,
              },
            );
            resolvedAccessToken = exchange.access_token;
          } catch (exchangeError) {
            console.error(
              "[SocialAuth] Facebook code exchange failed:",
              exchangeError.message,
            );
            return sendError(
              reply,
              401,
              "TOKEN_EXCHANGE_FAILED",
              "Facebook authorization code exchange failed.",
            );
          }
        }

        if (provider === "facebook" && !resolvedAccessToken) {
          return sendError(
            reply,
            400,
            "TOKEN_REQUIRED",
            "Facebook Sign-In requires an access token.",
          );
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
          console.error(
            `[SocialAuth] Token verification failed for ${provider}:`,
            verifyError.message,
          );

          const socialAuthErrorMap = {
            APPLE_CLIENT_ID_NOT_CONFIGURED: [
              501,
              "PROVIDER_NOT_CONFIGURED",
              "Apple authentication is not configured.",
            ],
            GOOGLE_CLIENT_ID: [
              501,
              "PROVIDER_NOT_CONFIGURED",
              "Google authentication is not configured.",
            ],
            FACEBOOK_APP_NOT_CONFIGURED: [
              501,
              "PROVIDER_NOT_CONFIGURED",
              "Facebook authentication is not configured.",
            ],
            NONCE_REQUIRED: [
              400,
              "NONCE_REQUIRED",
              "Apple Sign-In requires a nonce. Please try again.",
            ],
            INVALID_NONCE: [
              401,
              "INVALID_NONCE",
              "Sign-in session invalid. Please try again.",
            ],
            INVALID_TOKEN_FORMAT: [
              400,
              "INVALID_TOKEN",
              "Invalid authentication token format.",
            ],
            INVALID_FACEBOOK_TOKEN: [
              401,
              "INVALID_TOKEN",
              "Invalid authentication token. Please try again.",
            ],
            expired: [
              401,
              "TOKEN_EXPIRED",
              "Sign-in session expired. Please try again.",
            ],
            "invalid signature": [
              401,
              "INVALID_TOKEN",
              "Invalid authentication token. Please try again.",
            ],
            INVALID_TOKEN: [
              401,
              "INVALID_TOKEN",
              "Invalid authentication token. Please try again.",
            ],
          };

          for (const [pattern, [status, code, message]] of Object.entries(
            socialAuthErrorMap,
          )) {
            if (verifyError.message.includes(pattern)) {
              return sendError(reply, status, code, message);
            }
          }
          return sendError(
            reply,
            401,
            "VERIFICATION_FAILED",
            "Could not verify authentication token.",
          );
        }

        const providerUserId = verifiedToken.sub;
        const userEmail = verifiedToken.emailVerified
          ? verifiedToken.email
          : null;
        const userName = verifiedToken.name || name || null; // Apple sends name separately on first auth

        // Optional: exchange Apple authorization code for refresh token (server-side validation capability)
        let appleRefreshToken = null;
        if (provider === "apple" && authorization_code) {
          try {
            const exchange =
              await exchangeAppleAuthorizationCode(authorization_code);
            appleRefreshToken = exchange.refresh_token || null;
          } catch (exchangeError) {
            console.warn(
              "[SocialAuth] Apple auth code exchange failed:",
              exchangeError.message,
            );
          }
        }

        if (!providerUserId) {
          return sendError(
            reply,
            400,
            "INVALID_TOKEN",
            "Could not extract user ID from token.",
          );
        }

        // Resolve user by identity via identity service
        let resolved = await identityService.resolveUserByIdentity(
          db,
          provider,
          providerUserId,
        );

        // Handle orphaned provider rows pointing to deleted users
        if (!resolved) {
          const orphan =
            await authRouteProviderLinkingRepository.findProviderForDeletedUser(
              provider,
              providerUserId,
            );
          if (orphan) {
            await authRouteProviderLinkingRepository.revokeProvider(orphan.id);
            console.warn(
              `[SocialAuth] Revoked orphaned provider ${orphan.id} for deleted user`,
            );
          }
        }

        let userId;
        let identityId;
        let isNewUser = false;

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
                providerData =
                  typeof resolved.identity.providerData === "string"
                    ? JSON.parse(resolved.identity.providerData)
                    : resolved.identity.providerData;
              } catch {
                providerData = {};
              }
            }
            providerData.apple_refresh_token = appleRefreshToken;
            providerData.apple_refresh_obtained_at = new Date().toISOString();
            await authRouteProviderLinkingRepository.updateProviderData(
              identityId,
              providerData,
            );
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
          // New identity — detect an existing account, but never link to it from
          // this unauthenticated route. A matching provider email proves control
          // of that email, not authority to attach a new login method to an
          // existing Porizo account. Linking is handled by authenticated
          // /auth/identity/link/* routes with fresh provider proof.
          isNewUser = true;

          // Check if email already exists via contacts (link accounts, exclude soft-deleted)
          // Only auto-link if the existing account's email is verified AND user confirms
          if (userEmail) {
            const existingUser =
              await identityRepository.findActiveUserByVerifiedContact(
                "email",
                userEmail.toLowerCase(),
              );
            if (existingUser) {
              const emailParts = userEmail.toLowerCase().split("@");
              const maskedEmail =
                emailParts[0].slice(0, 2) + "***@" + emailParts[1];
              const providerRows =
                await identityRepository.listAuthProvidersForUser(
                  existingUser.id,
                );
              return reply.status(200).send({
                account_exists: true,
                requires_existing_account_authentication: true,
                masked_email: maskedEmail,
                auth_methods: providerRows.map((row) => row.provider),
                provider,
              });
            }
          }

          const now = new Date().toISOString();
          const providerData = {
            email: userEmail,
            ...(appleRefreshToken
              ? {
                  apple_refresh_token: appleRefreshToken,
                  apple_refresh_obtained_at: now,
                }
              : {}),
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
              {
                type: provider,
                subject: providerUserId,
                providerData,
                verifiedAt: now,
              },
              {
                contacts,
                profile: {
                  displayName: userName,
                  locale: locale || null,
                  country: countryCode,
                },
              },
            );
            userId = result.userId;
            identityId = result.identityId;

            // Create free entitlements — compensate on failure
            try {
              await subscriptionManager.createFreeEntitlements(userId, {
                now,
                identity: { provider, subject: providerUserId },
              });
            } catch (err) {
              console.error(
                "[SocialAuth] Entitlement creation failed, cleaning up orphaned user:",
                err.message,
              );
              await identityRepository.deleteUserIdentityBootstrapRows(userId);
              throw err;
            }
          }

          // Record initial usage
          await identityService.recordIdentityUsage(db, identityId);
        }

        // Create session and tokens
        const { accessToken, refreshToken } = await createSessionAndTokens(
          userId,
          request,
          clientIp,
        );

        // Auto-link pending phone if present (from cross-identifier flow)
        if (request.body.pending_phone_link) {
          tryAutoLinkPhone(
            userId,
            request.body.pending_phone_link,
            clientIp,
          ).catch(() => {});
        }

        // Attribution matching for new social signups (non-blocking)
        if (isNewUser) {
          matchDownloadAttribution(userId, clientIp).catch(() => {});
          matchReceiverAttribution(userId, clientIp).catch(() => {});
        }

        // Log account-created signal for new social signups (distinct from login)
        if (isNewUser) {
          await authService.logAuthEvent({
            userId,
            eventType: "signup_success",
            ipAddress: clientIp,
            userAgent: request.headers["user-agent"],
            metadata: { method: provider },
          });
        }

        // Log event
        await authService.logAuthEvent({
          userId,
          eventType: "login_success",
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
        return sendError(
          reply,
          500,
          "SOCIAL_AUTH_FAILED",
          "Social authentication failed. Please try again.",
        );
      }
    },
  );

  // ==================== TOKEN REFRESH ====================

  app.post(
    "/auth/refresh",
    { schema: refreshSchema },
    async (request, reply) => {
      const { refresh_token } = request.body;

      try {
        // Verify and rotate the refresh token
        const result = await authService.rotateRefreshToken(refresh_token);
        if (!result.userId) {
          request.log.error(
            { resultKeys: Object.keys(result || {}) },
            "Refresh rotation missing userId",
          );
          return sendError(
            reply,
            401,
            "INVALID_REFRESH_TOKEN",
            "Invalid or expired refresh token.",
          );
        }
        const user = await authRouteSessionRepository.findUserAccountState(
          result.userId,
        );
        if (!user || user.deleted_at) {
          request.log.error(
            {
              userId: result.userId,
              userExists: Boolean(user),
              userDeleted: Boolean(user?.deleted_at),
            },
            "Refresh token resolved to missing/deleted user",
          );
          await authService.revokeAllRefreshTokensForUser(result.userId);
          await authService.compromiseAllTokenFamiliesForUser(result.userId);
          return sendError(
            reply,
            401,
            "INVALID_REFRESH_TOKEN",
            "Invalid or expired refresh token.",
          );
        }

        // Generate new access token
        const accessToken = authService.generateAccessToken(result.userId, {
          sessionId: result.sessionId || null,
        });

        // Record identity usage on refresh (non-blocking)
        // Find the identity associated with this user's most recent sign-in method
        const recentIdentity =
          await identityRepository.findMostRecentActiveIdentityForUser(
            result.userId,
          );
        if (recentIdentity) {
          identityService
            .recordIdentityUsage(db, recentIdentity.id)
            .catch((err) => {
              console.error(
                "[TokenRefresh] Failed to record identity usage:",
                err.message,
              );
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
          expires_in: 900,
        });
      } catch (error) {
        console.error("Token refresh error:", error.message);

        // Check error codes from auth-service for specific handling
        if (error.code === "TOKEN_REUSE_DETECTED") {
          await authService.logAuthEvent({
            eventType: "token_reuse_detected",
            ipAddress: getClientIp(request),
          });
          return sendError(
            reply,
            401,
            "TOKEN_REUSE_DETECTED",
            "Token reuse detected. Please login again.",
          );
        }

        if (error.code === "TOKEN_ALREADY_ROTATED") {
          // Grace period scenario - app killed during refresh. Recoverable via re-auth.
          return sendError(
            reply,
            401,
            "TOKEN_ALREADY_ROTATED",
            "Session expired. Please sign in again.",
          );
        }

        if (error.code === "TOKEN_FAMILY_COMPROMISED") {
          return sendError(
            reply,
            401,
            "TOKEN_FAMILY_COMPROMISED",
            "Session invalidated. Please login again.",
          );
        }

        if (error.code === "SESSION_REVOKED") {
          return sendError(
            reply,
            401,
            "SESSION_REVOKED",
            "Session revoked. Please login again.",
          );
        }

        if (error.code === "SESSION_BINDING_REQUIRED") {
          return sendError(
            reply,
            401,
            "SESSION_EXPIRED",
            "Session expired. Please sign in again.",
          );
        }

        return sendError(
          reply,
          401,
          "INVALID_REFRESH_TOKEN",
          "Invalid or expired refresh token.",
        );
      }
    },
  );

  // ==================== LOGOUT ====================

  app.post("/auth/logout", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(
        reply,
        401,
        "UNAUTHORIZED",
        "Missing authorization header.",
      );
    }

    try {
      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);

      // Revoke all refresh tokens for user (security: prevents token reuse)
      await authService.revokeAllRefreshTokensForUser(payload.sub);

      await authRouteSessionRepository.revokeActiveSessionsForUser(payload.sub);
      await magicLoginRepository.expirePendingAddEmailForAccount({
        accountId: payload.sub,
        expiredAt: new Date().toISOString(),
      });

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

  app.post(
    "/auth/forgot-password",
    { schema: forgotPasswordSchema },
    async (request, reply) => {
      const { email } = request.body;
      const clientIp = getClientIp(request);
      const normalizedEmail = email.toLowerCase();

      // Rate limit: 3/hour per email
      if (
        await consumeAuthRateLimit(
          `forgot:${normalizedEmail}`,
          3,
          60 * 60 * 1000,
        )
      ) {
        // Still return 200 to prevent enumeration
        return reply.send({
          message: "If an account exists, a reset email has been sent.",
        });
      }

      try {
        // Find user via identity service (email identity in user_auth_providers)
        const resolved = await identityService.resolveUserByIdentity(
          db,
          "email",
          normalizedEmail,
        );
        const user = resolved ? { id: resolved.userId } : null;

        if (user && emailService.isConfigured()) {
          // Create reset token
          const { token, expiresAt } =
            await authService.createPasswordResetToken(user.id);

          // Send email
          await emailService.sendPasswordResetEmail(
            normalizedEmail,
            token,
            expiresAt,
          );

          // Log event
          await authService.logAuthEvent({
            userId: user.id,
            eventType: "password_reset_requested",
            ipAddress: clientIp,
          });
        }

        // Always return same response to prevent enumeration
        return reply.send({
          message: "If an account exists, a reset email has been sent.",
        });
      } catch (error) {
        console.error("Forgot password error:", error);
        // Still return 200 to prevent enumeration
        return reply.send({
          message: "If an account exists, a reset email has been sent.",
        });
      }
    },
  );

  // ==================== RESET PASSWORD ====================

  app.post(
    "/auth/reset-password",
    { schema: resetPasswordSchema },
    async (request, reply) => {
      const { token, new_password } = request.body;
      const clientIp = getClientIp(request);

      try {
        // Verify token
        const { userId, tokenId } =
          await authService.verifyPasswordResetToken(token);

        // Hash new password
        const passwordHash = await authService.hashPassword(new_password);

        // Update password
        await authRouteCredentialRepository.updatePasswordCredential(
          userId,
          passwordHash,
        );

        // Mark token as used
        await authService.markPasswordResetTokenUsed(tokenId);

        // Invalidate all other reset tokens
        await authService.invalidateAllPasswordResetTokens(userId);

        // SECURITY: Revoke all refresh tokens and mark families as compromised
        // This forces re-authentication on all devices after password change
        await authService.revokeAllRefreshTokensForUser(userId);
        await authService.compromiseAllTokenFamiliesForUser(userId);

        await authRouteSessionRepository.revokeActiveSessionsForUser(userId);

        // Log event
        await authService.logAuthEvent({
          userId,
          eventType: "password_reset_completed",
          ipAddress: clientIp,
        });

        // Send security alert email
        if (emailService.isConfigured()) {
          const user = await authRouteProfileRepository.findUserEmail(userId);
          if (user?.email) {
            emailService
              .sendSecurityAlertEmail(user.email, {
                alertType: "password_changed",
                timestamp: new Date(),
              })
              .catch((err) =>
                console.error("Failed to send security alert:", err.message),
              );
          }
        }

        return reply.send({
          message:
            "Password reset successful. Please login with your new password.",
        });
      } catch (error) {
        console.error("Reset password error:", error.message);
        return sendError(
          reply,
          400,
          "INVALID_TOKEN",
          "Invalid or expired reset token.",
        );
      }
    },
  );

  // ==================== VERIFY EMAIL ====================

  app.post(
    "/auth/verify-email",
    { schema: verifyEmailSchema },
    async (request, reply) => {
      const { token } = request.body;

      try {
        const {
          userId,
          tokenId,
          email_normalized: emailNormalized,
        } = await authService.verifyEmailVerificationToken(token);
        const emailToVerify =
          emailNormalized ||
          (await authRouteProfileRepository.findUserEmail(userId))?.email;
        if (emailToVerify) {
          await identityService.verifyContact(
            db,
            userId,
            "email",
            emailToVerify,
            "email_token",
          );
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
        if (
          error instanceof identityService.IdentityError &&
          error.code === "E119_EMAIL_CONFLICT"
        ) {
          return sendError(
            reply,
            409,
            "EMAIL_ALREADY_VERIFIED",
            "This email is already verified by another account. Please use a different email or sign in to the existing account.",
          );
        }
        // Legacy unique constraint violation
        if (
          error.code === "23505" ||
          error.message?.includes("UNIQUE constraint") ||
          error.message?.includes("idx_users_verified_email")
        ) {
          return sendError(
            reply,
            409,
            "EMAIL_ALREADY_VERIFIED",
            "This email is already verified by another account. Please use a different email or sign in to the existing account.",
          );
        }
        return sendError(
          reply,
          400,
          "INVALID_TOKEN",
          "Invalid or expired verification token.",
        );
      }
    },
  );

  // ==================== USER PROFILE HELPERS ====================

  async function buildUserProfileResponse(userId) {
    const user = await authRouteProfileRepository.findActiveUserProfile(userId);

    if (!user) return null;

    // Auth methods with linked_at and last_used_at
    const providerRows =
      await authRouteProfileRepository.listActiveAuthProviders(userId);
    const providers = providerRows.map((p) => p.provider);

    const authMethods = providerRows.map((p) => {
      const method = {
        type: p.provider,
        linked_at: p.linked_at,
        last_used_at: p.last_used_at,
      };
      if (p.provider === "phone" && p.provider_user_id) {
        // Mask phone: +1***1234
        method.subject_masked =
          p.provider_user_id.slice(0, 3) + "***" + p.provider_user_id.slice(-4);
      }
      return method;
    });

    // Contacts from user_contacts table
    const contactRows = await authRouteProfileRepository.listContacts(userId);

    const contacts = contactRows.map((c) => ({
      type: c.type,
      value_display: c.value_display || c.value_normalized,
      verified: !!c.verified_at,
      is_primary: !!c.is_primary,
      ...(c.type === "email" ? { is_relay: !!c.is_relay } : {}),
    }));

    // Derive primary email and phone from contacts (prefer verified primary)
    const primaryEmailContact = contactRows.find(
      (c) => c.type === "email" && c.is_primary && c.verified_at,
    );
    const primaryPhoneContact = contactRows.find(
      (c) => c.type === "phone" && c.is_primary && c.verified_at,
    );

    // Profile completeness via identity service
    const completeness = await identityService.computeProfileCompleteness(
      db,
      userId,
    );

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
      // Surface the email/phone even when it's an unverified, not-yet-primary
      // contact (e.g. fresh signup): prefer a verified primary, then the legacy
      // mirror, then any contact of that type. Consumers use email_verified /
      // the contacts[] verified_at to tell verified from unverified.
      primary_email:
        primaryEmailContact?.value_normalized ||
        user.email ||
        contactRows.find((c) => c.type === "email")?.value_normalized ||
        null,
      primary_phone:
        primaryPhoneContact?.value_normalized ||
        user.phone_number ||
        contactRows.find((c) => c.type === "phone")?.value_normalized ||
        null,
      needs_profile_completion: !completeness.complete,
      missing_profile_requirements: completeness.missing,
    };
  }

  // ==================== GET CURRENT USER ====================

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const profile = await buildUserProfileResponse(request.userId);
    if (!profile) {
      return sendError(
        reply,
        401,
        "INVALID_TOKEN",
        "Invalid or expired access token.",
      );
    }
    return reply.send(profile);
  });

  // ==================== UPDATE PROFILE ====================

  app.patch(
    "/auth/profile",
    { schema: profileUpdateSchema, preHandler: requireAuth },
    async (request, reply) => {
      const { contact_email, display_name } = request.body || {};

      if (!contact_email && !display_name) {
        return sendError(
          reply,
          400,
          "MISSING_FIELDS",
          "At least one field (contact_email, display_name) is required.",
        );
      }

      // Fetch current user once for change detection (avoids redundant queries)
      const currentUser = await authRouteProfileRepository.findUserEmail(
        request.userId,
      );

      // Validate email format if provided
      if (contact_email != null) {
        const emailStr = String(contact_email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
          return sendError(
            reply,
            400,
            "INVALID_EMAIL",
            "Please provide a valid email address.",
          );
        }
        // Check uniqueness only if email actually changed
        if (!currentUser || currentUser.email !== emailStr) {
          const existing =
            await authRouteProfileRepository.findVerifiedEmailOwner({
              emailNormalized: emailStr,
              excludeUserId: request.userId,
            });
          if (existing) {
            return sendError(
              reply,
              409,
              "EMAIL_EXISTS",
              "This email is already associated with another account.",
            );
          }
        }
      }

      // Update display_name directly on users table
      if (display_name != null) {
        const trimmedName = String(display_name).trim();
        if (trimmedName.length > 100) {
          return sendError(
            reply,
            400,
            "INVALID_DISPLAY_NAME",
            "Display name must be 100 characters or fewer.",
          );
        }
        await authRouteProfileRepository.updateDisplayName(
          request.userId,
          trimmedName,
        );
      }

      // Handle email via identity service — creates/updates UNVERIFIED contact.
      // Mirror sync happens only after verification.
      if (contact_email != null) {
        const newEmail = String(contact_email).trim().toLowerCase();
        const emailChanged = !currentUser || currentUser.email !== newEmail;

        // Create or update contact as unverified
        const contactResult = await identityService.createOrUpdateContact(
          db,
          request.userId,
          {
            type: "email",
            value: newEmail,
            source: "user_entered",
          },
        );

        // Send verification email for changed email (fire-and-forget)
        if (emailChanged) {
          await authService.invalidateEmailVerificationTokens(request.userId);
        }
        if (emailChanged && emailService.isConfigured()) {
          authService
            .createEmailVerificationToken(request.userId, {
              email: newEmail,
              contactId: contactResult.contactId,
            })
            .then(({ token }) =>
              emailService.sendVerificationEmail(newEmail, token),
            )
            .catch((err) => {
              console.error(
                "[ProfileUpdate] Failed to send verification email:",
                err.message,
              );
            });
        }
      }

      const profile = await buildUserProfileResponse(request.userId);
      return reply.send(profile);
    },
  );

  // ==================== SKIP PROFILE COMPLETION ====================

  app.post(
    "/auth/profile/skip-completion",
    { preHandler: requireAuth },
    async (request, reply) => {
      // Analytics-only: records skip timestamp but does NOT affect needs_profile_completion.
      // buildUserProfileResponse uses computeProfileCompleteness() which ignores skip state.
      await authRouteProfileRepository.markProfileCompletionSkipped(
        request.userId,
      );

      return reply.send({ success: true });
    },
  );

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

  app.post(
    "/auth/phone/link",
    { schema: phoneLinkSchema, preHandler: requireAuth },
    async (request, reply) => {
      const { phone_number, code } = request.body;
      const clientIp = getClientIp(request);

      // Rate limit: 3 attempts per hour per user
      if (
        await consumeAuthRateLimit(
          `phone-link:${request.userId}`,
          3,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many linking attempts. Please try again later.",
        );
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
        const existingSelf =
          await authRouteProfileRepository.findLinkedPhoneForUser({
            userId: request.userId,
            phoneNumber: phone_number,
          });

        if (existingSelf) {
          const profile = await buildUserProfileResponse(request.userId);
          return reply.send({
            success: true,
            already_linked: true,
            ...profile,
          });
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
          metadata: {
            provider: "phone",
            phone_masked:
              phone_number.slice(0, 4) + "****" + phone_number.slice(-2),
          },
        });

        const profile = await buildUserProfileResponse(request.userId);
        return reply.send({ success: true, ...profile });
      } catch (error) {
        // Identity service conflict: phone already linked to another user
        if (
          error instanceof identityService.IdentityError &&
          error.code === "E118_PROVIDER_ALREADY_LINKED"
        ) {
          return sendError(
            reply,
            409,
            "E117_PHONE_EXISTS",
            "This phone number is already associated with another account.",
          );
        }
        // Catch UNIQUE constraint violation (race condition: phone linked to another user concurrently)
        if (
          error.code === "23505" ||
          error.message?.includes("UNIQUE constraint")
        ) {
          return sendError(
            reply,
            409,
            "E117_PHONE_EXISTS",
            "This phone number is already associated with another account.",
          );
        }
        console.error("Phone link error:", error);
        return sendError(
          reply,
          500,
          "E119_PHONE_ERROR",
          "Failed to link phone number. Please try again.",
        );
      }
    },
  );

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

  app.post(
    "/auth/identity/link/apple",
    { schema: appleLinkSchema, preHandler: requireAuth },
    async (request, reply) => {
      const { id_token, nonce, authorization_code } = request.body;
      const clientIp = getClientIp(request);

      // Rate limit: 3 attempts per hour per user
      if (
        await consumeAuthRateLimit(
          `apple-link:${request.userId}`,
          3,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many linking attempts. Please try again later.",
        );
      }

      try {
        // Verify Apple token (reuse existing verifier)
        const verifiedToken = await verifySocialToken("apple", id_token, {
          rawNonce: nonce,
        });

        const appleSub = verifiedToken.sub;
        if (!appleSub) {
          return sendError(
            reply,
            400,
            "INVALID_TOKEN",
            "Could not extract user ID from Apple token.",
          );
        }

        const now = new Date().toISOString();
        const providerData = {
          email: verifiedToken.email,
          emailVerified: verifiedToken.emailVerified,
          isPrivateEmail: verifiedToken.isPrivateEmail,
        };

        // Link Apple identity via identity service
        const { identityId } = await identityService.linkIdentityToUser(
          db,
          request.userId,
          {
            type: "apple",
            subject: appleSub,
            providerData,
            verifiedAt: now,
          },
        );

        // Exchange authorization_code for refresh token (optional, non-blocking for link success)
        if (authorization_code) {
          try {
            const exchange =
              await exchangeAppleAuthorizationCode(authorization_code);
            if (exchange.refresh_token) {
              providerData.apple_refresh_token = exchange.refresh_token;
              providerData.apple_refresh_obtained_at = now;
              await authRouteProviderLinkingRepository.updateProviderData(
                identityId,
                providerData,
              );
            }
          } catch (exchangeError) {
            console.warn(
              "[AppleLink] Auth code exchange failed:",
              exchangeError.message,
            );
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
            return sendError(
              reply,
              409,
              "E118_PROVIDER_ALREADY_LINKED",
              "This Apple ID is already associated with another account.",
            );
          }
          if (error.code === "E119_EMAIL_CONFLICT") {
            return sendError(
              reply,
              409,
              "E119_EMAIL_CONFLICT",
              "The email on this Apple ID is already linked to another account.",
            );
          }
        }
        console.error("Apple link error:", error);
        return sendError(
          reply,
          500,
          "LINK_ERROR",
          "Failed to link Apple ID. Please try again.",
        );
      }
    },
  );

  // ==================== EMAIL RESEND VERIFICATION (AUTHENTICATED) ====================

  app.post(
    "/auth/email/resend-verification",
    { preHandler: requireAuth },
    async (request, reply) => {
      // Rate limit: 3 per hour per user
      if (
        await consumeAuthRateLimit(
          `resend-verify:${request.userId}`,
          3,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many verification requests. Please try again later.",
        );
      }

      try {
        // Get current user's unverified email from user_contacts
        const unverifiedEmail =
          await authRouteProfileRepository.findLatestUnverifiedEmail(
            request.userId,
          );

        if (!unverifiedEmail) {
          return sendError(
            reply,
            400,
            "NO_PENDING_VERIFICATION",
            "No unverified email address found.",
          );
        }

        // Send verification for contact email
        if (!emailService.isConfigured()) {
          return sendError(
            reply,
            503,
            "EMAIL_NOT_CONFIGURED",
            "Email verification is not available.",
          );
        }

        const { token } = await authService.createEmailVerificationToken(
          request.userId,
          {
            email: unverifiedEmail.value_normalized,
          },
        );
        await emailService.sendVerificationEmail(
          unverifiedEmail.value_normalized,
          token,
        );

        const emailParts = unverifiedEmail.value_normalized.split("@");
        const maskedEmail = emailParts[0].slice(0, 2) + "***@" + emailParts[1];

        return reply.send({ success: true, email_masked: maskedEmail });
      } catch (error) {
        console.error("Resend verification error:", error);
        return sendError(
          reply,
          500,
          "E119_EMAIL_ERROR",
          "Failed to send verification email. Please try again.",
        );
      }
    },
  );

  // ==================== LIST SESSIONS ====================

  app.get(
    "/auth/sessions",
    { preHandler: requireAuth },
    async (request, reply) => {
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
    },
  );

  // ==================== REVOKE SESSION ====================

  app.delete(
    "/auth/sessions/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const sessionId = request.params.id;

      // Verify session belongs to user
      const session =
        await authRouteSessionRepository.findSessionOwner(sessionId);
      if (!session || session.user_id !== request.userId) {
        return sendError(reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      }

      await authService.revokeSession(sessionId);
      await magicLoginRepository.expirePendingAddEmailForSession({
        sessionId,
        expiredAt: new Date().toISOString(),
      });

      return reply.send({ message: "Session revoked successfully." });
    },
  );

  // ==================== PHONE AUTH: SEND CODE ====================

  app.post(
    "/auth/phone/send-code",
    { schema: phoneSendCodeSchema },
    async (request, reply) => {
      const { phone_number } = request.body;
      const clientIp = getClientIp(request);

      // Rate limit: 5/hour per IP
      if (
        await consumeAuthRateLimit(`phone-send:${clientIp}`, 5, 60 * 60 * 1000)
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many verification requests. Please try again later.",
        );
      }

      // Validate E.164 format before per-phone rate limit so we don't key on garbage input
      if (!isValidE164(phone_number)) {
        return sendError(
          reply,
          400,
          "E111_INVALID_PHONE",
          "Invalid phone number format. Use E.164 format (e.g., +12025551234).",
        );
      }

      // Rate limit: 5/hour per phone number — prevents SMS bombing a single number from multiple IPs
      if (
        await consumeAuthRateLimit(
          `sms:phone:${phone_number}`,
          5,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many verification requests for this number.",
        );
      }

      try {
        // Check if SMS service is configured
        if (!smsService.isConfigured()) {
          return sendError(
            reply,
            503,
            "E112_SMS_NOT_CONFIGURED",
            "SMS verification is not available.",
          );
        }

        // Send verification code via SMS service
        const result = await smsService.sendVerificationCode(phone_number);

        if (!result.success) {
          // Handle rate limit from SMS service
          if (result.retryAfterSeconds) {
            reply.header("Retry-After", result.retryAfterSeconds);
            return sendError(
              reply,
              429,
              "E110_RATE_LIMITED",
              result.error || "Too many verification attempts.",
            );
          }
          return sendError(
            reply,
            400,
            "E113_SMS_FAILED",
            result.error || "Failed to send verification code.",
          );
        }

        return reply.send({
          success: true,
          expires_at: result.expiresAt,
          masked_phone: result.maskedPhone,
        });
      } catch (error) {
        console.error("Phone send code error:", error);
        return sendError(
          reply,
          500,
          "E119_PHONE_ERROR",
          "Failed to send verification code. Please try again.",
        );
      }
    },
  );

  // ==================== PHONE AUTH: VERIFY CODE ====================

  app.post(
    "/auth/phone/verify",
    { schema: phoneVerifySchema },
    async (request, reply) => {
      const { phone_number, code } = request.body;
      const clientIp = getClientIp(request);

      // Rate limit: 10/hour per IP
      if (
        await consumeAuthRateLimit(
          `phone-verify:${clientIp}`,
          10,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many verification attempts. Please try again later.",
        );
      }

      // Validate E.164 format
      if (!isValidE164(phone_number)) {
        return sendError(
          reply,
          400,
          "E111_INVALID_PHONE",
          "Invalid phone number format.",
        );
      }

      try {
        // Verify code via SMS service
        const result = await smsService.verifyCode(phone_number, code);

        if (result.verified) {
          // Resolve user by phone identity via identity service
          const resolved = await identityService.resolveUserByIdentity(
            db,
            "phone",
            phone_number,
          );

          if (resolved) {
            // Phone already registered - login
            await identityService.recordIdentityUsage(db, resolved.identity.id);

            const { accessToken, refreshToken } = await createSessionAndTokens(
              resolved.userId,
              request,
              clientIp,
            );

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
              expires_in: 900,
            });
          }

          // New phone - create registration token for signup
          const registrationToken = await createRegistrationToken(
            phoneRegistrationTokenRepository,
            phone_number,
            clientIp,
          );

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
        return sendError(
          reply,
          500,
          "E119_PHONE_ERROR",
          "Verification failed. Please try again.",
        );
      }
    },
  );

  // ==================== PHONE AUTH: REGISTER ====================

  app.post(
    "/auth/phone/register",
    { schema: phoneRegisterSchema },
    async (request, reply) => {
      const { registration_token, phone_number, name, email, locale, country } =
        request.body;
      const clientIp = getClientIp(request);
      const countryCode = registrationCountry({
        explicitCountry: country,
        clientIp,
      });
      const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

      // Rate limit: 5/hour per IP (same as signup)
      if (
        await consumeAuthRateLimit(
          `phone-register:${clientIp}`,
          5,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "E110_RATE_LIMITED",
          "Too many registration attempts. Please try again later.",
        );
      }

      try {
        // Validate registration token against provided phone number
        const tokenResult = await consumeRegistrationToken(
          phoneRegistrationTokenRepository,
          registration_token,
          phone_number,
          clientIp,
        );
        if (!tokenResult.valid) {
          return sendError(
            reply,
            400,
            "E114_INVALID_TOKEN",
            "Invalid or expired registration token. Please verify your phone again.",
          );
        }

        const phoneNumber = tokenResult.phone_number;

        // Cross-identifier dedup: check phone AND email (if provided) against existing accounts
        // Email cross-check only matches verified emails (prevents unverified email claims)
        const existingAccount = await findExistingAccountByIdentifiers(
          identityRepository,
          {
            phone: phoneNumber,
            ...(normalizedEmail ? { email: normalizedEmail } : {}),
          },
        );

        if (existingAccount.exists) {
          // Privacy: caller verified ownership of THIS phone via OTP. If the matched
          // account was found via email (not phone), the matched user's phone may be
          // different — never disclose another user's phone to a caller who only
          // proved phone X. Only return masked_phone when the phone match itself
          // located the account.
          const safeMaskedPhone =
            existingAccount.matchedVia === "phone"
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
          {
            type: "phone",
            value: phoneNumber,
            source: "phone_otp",
            verified: true,
          },
        ];
        if (normalizedEmail) {
          contacts.push({
            type: "email",
            value: normalizedEmail,
            source: "user_entered",
            verified: false,
          });
        }

        const { userId, identityId } =
          await identityService.createUserWithIdentity(
            db,
            { type: "phone", subject: phoneNumber, verifiedAt: now },
            {
              contacts,
              profile: {
                displayName: name || null,
                locale: locale || null,
                country: countryCode,
              },
            },
          );

        // Create free entitlements — compensate on failure
        try {
          await subscriptionManager.createFreeEntitlements(userId, {
            now,
            identity: { provider: "phone", subject: phoneNumber },
          });
        } catch (err) {
          console.error(
            "[PhoneRegister] Entitlement creation failed, cleaning up orphaned user:",
            err.message,
          );
          await identityRepository.deleteUserIdentityBootstrapRows(userId);
          throw err;
        }

        // Record initial usage
        await identityService.recordIdentityUsage(db, identityId);

        // Create session and tokens
        const { accessToken, refreshToken } = await createSessionAndTokens(
          userId,
          request,
          clientIp,
        );

        // Send verification email for self-asserted email (fire-and-forget)
        if (normalizedEmail && emailService.isConfigured()) {
          authService
            .createEmailVerificationToken(userId, { email: normalizedEmail })
            .then(({ token }) => {
              emailService
                .sendVerificationEmail(normalizedEmail, token)
                .catch((err) => {
                  console.error(
                    "Failed to send verification email:",
                    err.message,
                  );
                });
            });
        }

        // Attribution matching (non-blocking)
        matchDownloadAttribution(userId, clientIp).catch(() => {});
        matchReceiverAttribution(userId, clientIp).catch(() => {});

        // Log account-created signal (distinct from login_success)
        await authService.logAuthEvent({
          userId,
          eventType: "signup_success",
          ipAddress: clientIp,
          userAgent: request.headers["user-agent"],
          metadata: {
            method: "phone",
            has_email: Boolean(normalizedEmail),
          },
        });

        // Log event
        await authService.logAuthEvent({
          userId,
          eventType: "login_success",
          ipAddress: clientIp,
          userAgent: request.headers["user-agent"],
          metadata: {
            method: "phone_signup",
            has_email: Boolean(normalizedEmail),
          },
        });

        return reply.status(201).send({
          user_id: userId,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 900,
        });
      } catch (error) {
        console.error("Phone register error:", error);
        return sendError(
          reply,
          500,
          "E119_PHONE_ERROR",
          "Registration failed. Please try again.",
        );
      }
    },
  );

  // ==================== USERNAME AVAILABILITY ====================

  app.get(
    "/users/username/available",
    { schema: usernameAvailableSchema },
    async (request, reply) => {
      const { username } = request.query;
      const clientIp = getClientIp(request);

      // Rate limit: 30/minute per IP to prevent bulk username enumeration
      if (
        await consumeAuthRateLimit(`username-check:${clientIp}`, 30, 60 * 1000)
      ) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Too many requests. Please try again later.",
        );
      }

      // Validate username format first
      if (!isValidUsername(username)) {
        return reply.send({
          available: false,
          error:
            "Username must be 3-20 characters, start with a letter, and contain only letters, numbers, and underscores.",
        });
      }

      try {
        const normalizedUsername = username.toLowerCase();

        // Check if username exists
        const existing =
          await authRouteProfileRepository.findActiveUserByUsername(
            normalizedUsername,
          );

        if (existing) {
          // Generate suggestions
          const suggestions = [];
          const base = normalizedUsername.slice(0, 15); // Leave room for suffix

          for (let i = 0; i < 3; i++) {
            const suffix = crypto.randomBytes(2).toString("hex").slice(0, 3);
            const suggestion = `${base}_${suffix}`;
            if (isValidUsername(suggestion)) {
              const suggestionExists =
                await authRouteProfileRepository.findActiveUserByUsername(
                  suggestion,
                );
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
        return sendError(
          reply,
          500,
          "E118_CHECK_FAILED",
          "Failed to check username availability.",
        );
      }
    },
  );

  // ==================== DELETE ACCOUNT (GDPR Article 17) ====================

  app.delete(
    "/auth/delete-account",
    { preHandler: requireAuth },
    async (request, reply) => {
      const clientIp = getClientIp(request);

      // Rate limit: 1 per hour per user (prevent abuse)
      if (
        await consumeAuthRateLimit(
          `delete-account:${request.userId}`,
          1,
          60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Please wait before retrying account deletion.",
        );
      }

      try {
        const accountDeletionAuditLog =
          gdprAuditService.createAccountDeletionAuditLog(
            request.userId,
            clientIp,
          );

        // Perform cascading deletion and write the GDPR audit row atomically.
        await authService.deleteUserAccount(request.userId, {
          accountDeletionAuditLog,
        });

        // Return 204 No Content on success
        return reply.code(204).send();
      } catch (error) {
        console.error("[DeleteAccount] Failed:", error);

        if (error.message === "User not found") {
          return sendError(reply, 404, "USER_NOT_FOUND", "Account not found.");
        }

        return sendError(
          reply,
          500,
          "DELETION_FAILED",
          "Account deletion failed. Please contact support.",
        );
      }
    },
  );

  // GDPR Article 20 — data portability. Returns the authenticated user's own
  // personal data as a downloadable JSON bundle. Self-scoped via requireAuth +
  // request.userId; never accepts a target user id.
  app.get(
    "/auth/data-export",
    { preHandler: requireAuth },
    async (request, reply) => {
      const clientIp = getClientIp(request);

      // Rate limit: 3 per day per user (export assembles many tables; abuse guard).
      if (
        await consumeAuthRateLimit(
          `data-export:${request.userId}`,
          3,
          24 * 60 * 60 * 1000,
        )
      ) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Please wait before requesting another data export.",
        );
      }

      try {
        const exportBundle = await authService.exportUserData(request.userId);

        // Log GDPR compliance event (Article 20 request record)
        await gdprAuditService.logDataExportRequest(
          request.userId,
          clientIp,
          "json",
        );

        reply.header(
          "Content-Disposition",
          'attachment; filename="porizo-data-export.json"',
        );
        return reply.send(exportBundle);
      } catch (error) {
        console.error("[DataExport] Failed:", error);

        if (error.message === "User not found") {
          return sendError(reply, 404, "USER_NOT_FOUND", "Account not found.");
        }

        return sendError(
          reply,
          500,
          "EXPORT_FAILED",
          "Data export failed. Please contact support.",
        );
      }
    },
  );
}

module.exports = {
  registerAuthRoutes,
  clearRateLimits,
  clearRegistrationTokens,
};
