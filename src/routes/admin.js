"use strict";

const jwt = require("jsonwebtoken");
const jwksRsa = require("jwks-rsa");
const { AdminService } = require("../services/admin-service");
const { AdminGiftOpsService } = require("../services/admin-gift-ops-service");
const { BlogService } = require("../services/blog-service");
const {
  createAdminMarketingRepository,
} = require("../database/admin-marketing-repository");
const {
  createAdminDemoShareRepository,
} = require("../database/admin-demo-share-repository");
const {
  createAdminTrackTransferRepository,
} = require("../database/admin-track-transfer-repository");
const {
  createAdminBillingRepository,
} = require("../database/admin-billing-repository");
const {
  createAdminAuthRepository,
} = require("../database/admin-auth-repository");
const {
  createAdminMusicDiagnosticsRepository,
} = require("../database/admin-music-diagnostics-repository");
const { newUuid } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const { getClientIp: extractClientIp } = require("../utils/client-ip");
const defaultOneSignalService = require("../services/onesignal");
const { registerAdminAnalyticsRoutes } = require("./admin/analytics");
const { registerAdminBillingRoutes } = require("./admin/billing");
const {
  registerAdminBlendAnalysisRoutes,
} = require("./admin/blend-analysis");
const { registerAdminBlogRoutes } = require("./admin/blog");
const { registerAdminDemoShareRoutes } = require("./admin/demo-shares");
const {
  registerAdminFeatureFlagRoutes,
} = require("./admin/feature-flags");
const { registerAdminGiftOpsRoutes } = require("./admin/gift-ops");
const { registerAdminGrowthRoutes } = require("./admin/growth");
const { registerAdminJobOpsRoutes } = require("./admin/job-ops");
const { registerAdminKpiRoutes } = require("./admin/kpis");
const { registerAdminMetricsRoutes } = require("./admin/metrics");
const { registerAdminModerationRoutes } = require("./admin/moderation");
const { registerAdminMarketingRoutes } = require("./admin/marketing");
const {
  registerAdminMusicDiagnosticsRoutes,
} = require("./admin/music-diagnostics");
const {
  registerAdminOnboardingSampleRoutes,
} = require("./admin/onboarding-samples");
const {
  registerAdminProviderConfigRoutes,
} = require("./admin/provider-config");
const {
  registerAdminProviderQueueControlRoutes,
} = require("./admin/provider-queue-control");
const {
  registerAdminSecurityConfigRoutes,
} = require("./admin/security-config");
const {
  registerAdminSecurityObservabilityRoutes,
} = require("./admin/security-observability");
const { registerAdminShareRoutes } = require("./admin/shares");
const { registerAdminStaticUiRoutes } = require("./admin/static-ui");
const {
  registerAdminStorySessionRoutes,
} = require("./admin/story-sessions");
const {
  registerAdminTrackTransferRoutes,
} = require("./admin/track-transfer");
const {
  registerAdminWebhookHealthRoutes,
} = require("./admin/webhook-health");
const { registerClientConfigRoutes } = require("./client-config");
const { registerAdminUserReadRoutes } = require("./admin/users-read");
const {
  registerAdminUserSessionControlRoutes,
} = require("./admin/user-session-controls");
const { registerAdminUserMutationRoutes } = require("./admin/user-mutations");

const cloudflareAccessJwksClients = new Map();

function getCloudflareAccessJwksClient(certsUrl) {
  if (!cloudflareAccessJwksClients.has(certsUrl)) {
    cloudflareAccessJwksClients.set(
      certsUrl,
      jwksRsa({
        jwksUri: certsUrl,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }),
    );
  }
  return cloudflareAccessJwksClients.get(certsUrl);
}

async function verifyCloudflareAccessJwt(token, appConfig) {
  const audience = appConfig.CLOUDFLARE_ACCESS_AUD;
  const issuer = appConfig.CLOUDFLARE_ACCESS_ISSUER;
  const certsUrl = appConfig.CLOUDFLARE_ACCESS_CERTS_URL;

  if (!audience || !issuer || !certsUrl) {
    return null;
  }

  const client = getCloudflareAccessJwksClient(certsUrl);
  const getKey = (header, callback) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        callback(err);
        return;
      }
      callback(null, key.getPublicKey());
    });
  };

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ["RS256"],
        audience,
        issuer: issuer.replace(/\/$/, ""),
      },
      (err, decoded) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(decoded);
      },
    );
  });
}

function registerAdminRoutes(
  app,
  {
    db,
    appConfig,
    sendError,
    adminAuthService,
    subscriptionManager,
    planConfigService,
    emailService,
    oneSignalService = defaultOneSignalService,
    adminDemoShareRepository,
    adminTrackTransferRepository,
    adminBillingRepository,
    adminAuthRepository,
    adminMusicDiagnosticsRepository,
    clientConfigService,
  },
) {
  // ============ ADMIN DASHBOARD API ============

  const adminService = new AdminService(db);
  const publicClientConfigService =
    clientConfigService || adminService.clientConfigService;
  const adminGiftOpsService = new AdminGiftOpsService(db);
  const blogService = new BlogService(db);
  const adminMarketingRepository = createAdminMarketingRepository(db);
  const adminDemoShareRepo =
    adminDemoShareRepository || createAdminDemoShareRepository(db);
  const adminTrackTransferRepo =
    adminTrackTransferRepository || createAdminTrackTransferRepository(db);
  const adminBillingRepo =
    adminBillingRepository || createAdminBillingRepository(db);
  const adminAuthRepo =
    adminAuthRepository || createAdminAuthRepository(db);
  const adminMusicDiagnosticsRepo =
    adminMusicDiagnosticsRepository || createAdminMusicDiagnosticsRepository(db);
  adminAuthService.initialize(db);

  // SECURITY (WS2 / P1): global admin auth gate. Every /admin/dashboard* route
  // requires a valid admin session by default, so a single forgotten inline
  // requireAdminSession call can never leak data. The inline guards are kept as
  // defense-in-depth (they reuse request.admin set here). /admin/auth/* is NOT
  // gated (login/logout/forgot/reset/setup must be reachable unauthenticated).
  app.addHook("onRequest", async (request, reply) => {
    const routePath =
      request.routerPath || request.routeOptions?.url || request.raw?.url || "";
    if (!routePath.startsWith("/admin/dashboard")) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      sendError(reply, 401, "UNAUTHORIZED", "Missing authorization token");
      return reply;
    }

    const admin = await adminAuthService.validateSession(authHeader.slice(7));
    if (!admin) {
      sendError(reply, 401, "UNAUTHORIZED", "Invalid or expired session");
      return reply;
    }

    // Make the resolved admin available to inline guards (no re-validation).
    request.admin = admin;
  });
  const adminUiMode = String(appConfig.ADMIN_UI_MODE || "public").toLowerCase();
  const adminUiAllowedEmails = new Set(
    String(appConfig.ADMIN_UI_ALLOWED_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  /**
   * Admin session auth helper - validates Bearer token from Authorization header
   * Returns admin info if valid, null if invalid (and sends error response)
   */
  async function requireAdminSession(request, reply) {
    // reply.sent-aware: the global onRequest hook below may have already replied
    // (401) for an unauthenticated /admin/dashboard request. If so, do not
    // double-send — just return the resolved admin (or null) without writing.
    if (reply.sent) {
      return request.admin || null;
    }
    // If the global hook already resolved+validated the admin, reuse it.
    if (request.admin) {
      return request.admin;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      sendError(reply, 401, "UNAUTHORIZED", "Missing authorization token");
      return null;
    }

    const token = authHeader.slice(7);
    const admin = await adminAuthService.validateSession(token);

    if (!admin) {
      sendError(reply, 401, "UNAUTHORIZED", "Invalid or expired session");
      return null;
    }

    return admin;
  }

  /**
   * Require specific admin role(s) for an endpoint.
   * @param {object} request - Fastify request
   * @param {object} reply - Fastify reply
   * @param {string[]} allowedRoles - Array of allowed roles (e.g., ['superadmin'])
   * @returns {object|null} Admin object if authorized, null if denied
   */
  async function requireAdminRole(request, reply, allowedRoles) {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return null;

    if (!allowedRoles.includes(admin.role)) {
      sendError(
        reply,
        403,
        "FORBIDDEN",
        `This action requires one of: ${allowedRoles.join(", ")}`,
      );
      return null;
    }

    return admin;
  }

  /**
   * Parse pagination params from query with defaults
   */
  function parsePagination(query, defaultLimit = 50) {
    return {
      limit: Math.max(
        1,
        Math.min(100, parseInt(query.limit, 10) || defaultLimit),
      ),
      offset: Math.max(0, parseInt(query.offset, 10) || 0),
    };
  }

  function validateReason(reason, reply) {
    if (!reason || reason.trim().length < 10) {
      sendError(
        reply,
        400,
        "MISSING_REASON",
        "Reason must be at least 10 characters",
      );
      return null;
    }
    if (reason.trim().length > 500) {
      sendError(
        reply,
        400,
        "INVALID_REASON",
        "Reason must not exceed 500 characters",
      );
      return null;
    }
    return reason.trim();
  }

  function getCloudflareAccessEmail(request) {
    return String(request.headers["cf-access-authenticated-user-email"] || "")
      .trim()
      .toLowerCase();
  }

  async function getVerifiedCloudflareAccessEmail(request) {
    const assertion = String(
      request.headers["cf-access-jwt-assertion"] || "",
    ).trim();

    if (
      appConfig.CLOUDFLARE_ACCESS_AUD &&
      appConfig.CLOUDFLARE_ACCESS_ISSUER &&
      appConfig.CLOUDFLARE_ACCESS_CERTS_URL
    ) {
      if (!assertion) return "";
      const decoded = await verifyCloudflareAccessJwt(assertion, appConfig);
      return String(decoded?.email || "")
        .trim()
        .toLowerCase();
    }

    return getCloudflareAccessEmail(request);
  }

  async function requireAdminUiAccess(request, reply) {
    if (adminUiMode === "public") return true;

    if (adminUiMode === "off") {
      reply.code(404).type("text/plain").send("Not Found");
      return false;
    }

    if (adminUiMode === "cloudflare_access") {
      let email = "";
      try {
        email = await getVerifiedCloudflareAccessEmail(request);
      } catch (err) {
        request.log.warn(
          { err: err?.message },
          "Cloudflare Access JWT verification failed",
        );
      }
      if (!email) {
        reply.code(403).type("text/plain").send("Admin access required");
        return false;
      }
      if (adminUiAllowedEmails.size > 0 && !adminUiAllowedEmails.has(email)) {
        reply.code(403).type("text/plain").send("Admin access denied");
        return false;
      }
      return true;
    }

    app.log.warn({ adminUiMode }, "Unknown ADMIN_UI_MODE; hiding admin UI");
    reply.code(404).type("text/plain").send("Not Found");
    return false;
  }

  // --- Admin Authentication ---

  // One-time setup endpoint - protected by ADMIN_SETUP_SECRET env var
  // Remove this after initial admin is created
  app.post("/admin/auth/setup", async (request, reply) => {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret) {
      return sendError(reply, 404, "NOT_FOUND", "Setup disabled");
    }

    const { secret, email, password, displayName } = request.body || {};
    if (secret !== setupSecret) {
      return sendError(reply, 401, "UNAUTHORIZED", "Invalid setup secret");
    }

    if (!email || !password) {
      return sendError(
        reply,
        400,
        "BAD_REQUEST",
        "Email and password required",
      );
    }

    const result = await adminAuthService.createAdmin(
      email,
      password,
      displayName || "Admin",
      "superadmin",
    );
    if (!result.success) {
      return sendError(reply, 400, "BAD_REQUEST", result.error);
    }

    reply.send({
      success: true,
      id: result.id,
      message:
        "Admin created. Remove ADMIN_SETUP_SECRET to disable this endpoint.",
    });
  });

  // Rate-limit window for admin login attempts. Mirrors the forgot-password
  // pattern (per-email + per-IP) but tuned for login: tighter per-email,
  // looser per-IP, and fail-closed on DB error / undeterminable IP.
  const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const ADMIN_LOGIN_RETRY_AFTER_SECONDS = Math.ceil(
    ADMIN_LOGIN_WINDOW_MS / 1000,
  );
  const ADMIN_LOGIN_GENERIC_FAILURE = {
    error: "UNAUTHORIZED",
    message: "Invalid credentials",
  };

  function sendAdminLoginRateLimited(reply) {
    return reply
      .code(429)
      .header("Retry-After", String(ADMIN_LOGIN_RETRY_AFTER_SECONDS))
      .send({
        error: "RATE_LIMITED",
        message: "Too many login attempts. Please try again later.",
      });
  }

  app.post("/admin/auth/login", async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return sendError(
        reply,
        400,
        "BAD_REQUEST",
        "Email and password required",
      );
    }

    const clientIp = getAdminClientIp(request);
    const normalizedEmail = String(email).toLowerCase().trim();

    // Fail-closed when the real client IP can't be determined: an unkeyable
    // login attempt would otherwise dodge the per-IP throttle entirely.
    if (clientIp === "unknown") {
      console.warn(
        "[Admin:login] rejected — client IP undeterminable (fail-closed)",
      );
      return sendAdminLoginRateLimited(reply);
    }

    // Two rate-limit dimensions, both fail-closed:
    //   - per-email: stops spraying many passwords at one admin (10 / 15 min)
    //   - per-IP:    stops one host spraying across many emails (30 / 15 min)
    const emailLimited = await consumeAdminAuthRateLimit(
      normalizedEmail,
      "admin_login_email",
      10,
      ADMIN_LOGIN_WINDOW_MS,
      { failClosed: true },
    );
    if (emailLimited) return sendAdminLoginRateLimited(reply);

    const ipLimited = await consumeAdminAuthRateLimit(
      clientIp,
      "admin_login_ip",
      30,
      ADMIN_LOGIN_WINDOW_MS,
      { failClosed: true },
    );
    if (ipLimited) return sendAdminLoginRateLimited(reply);

    const userAgent = request.headers["user-agent"];
    const result = await adminAuthService.login(
      email,
      password,
      clientIp,
      userAgent,
    );

    if (!result.success) {
      return reply.code(401).send(ADMIN_LOGIN_GENERIC_FAILURE);
    }

    reply.send(result);
  });

  app.post("/admin/auth/logout", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      adminAuthService.logout(authHeader.slice(7));
    }
    reply.send({ success: true });
  });

  app.get("/admin/auth/me", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(admin);
  });

  app.post("/admin/auth/change-password", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({
        error: "MISSING_FIELDS",
        message: "Current and new password required",
      });
    }
    if (newPassword.length < 12) {
      return reply.code(400).send({
        error: "WEAK_PASSWORD",
        message: "Password must be at least 12 characters",
      });
    }

    // Verify current password first
    const loginResult = await adminAuthService.login(
      admin.email,
      currentPassword,
    );
    if (!loginResult.success) {
      return reply.code(401).send({
        error: "INVALID_PASSWORD",
        message: "Current password is incorrect",
      });
    }

    // Change password (this also invalidates all sessions)
    await adminAuthService.changePassword(admin.adminId, newPassword);
    reply.send({
      success: true,
      message: "Password changed. Please log in again.",
    });
  });

  // --- Admin Password Reset (Forgot / Reset) ---

  // Generic response used by /admin/auth/forgot-password regardless of
  // whether the email maps to an admin. Always returning the same body +
  // status code is what prevents this endpoint from being an account-
  // enumeration oracle. Do not change to something more specific.
  const ADMIN_FORGOT_GENERIC_RESPONSE = {
    message: "If an account exists for that email, a reset link has been sent.",
  };

  /**
   * DB-backed sliding-window rate limit for the public admin auth endpoints.
   *
   * Lighter than the user-side `consumeAuthRateLimit` (no in-memory cache)
   * since admin traffic volume doesn't warrant the cache complexity. Uses
   * the same `rate_limits` table so ops dashboards see admin traffic in
   * the same place.
   *
   * @param {string} key   - Subject of the limit (e.g. an email or IP)
   * @param {string} scope - Distinguishes limit type, e.g. "admin_forgot_email"
   * @param {number} limit - Max events per window
   * @param {number} windowMs - Window width in ms
   * @param {{ failClosed?: boolean }} [options] - When failClosed is true, a DB
   *   error returns true (treat as rate-limited) so the protected endpoint
   *   blocks rather than silently disabling throttling. Defaults to fail-open
   *   for password recovery (a transient DB issue shouldn't lock admins out of
   *   recovery).
   * @returns {Promise<boolean>} true when the request should be rejected
   */
  async function consumeAdminAuthRateLimit(
    key,
    scope,
    limit,
    windowMs,
    options = {},
  ) {
    try {
      const windowSeconds = Math.ceil(windowMs / 1000);
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const actionKey = `admin_auth:${scope}`;

      const count = await adminAuthRepo.incrementRateLimitWindow({
        key,
        actionKey,
        windowStartMs: windowStart,
        windowSeconds,
        limitCount: limit,
      });
      return count > limit;
    } catch (err) {
      // Default fail-open: a transient rate-limit table issue should not lock
      // admins out of password recovery. For login (failClosed:true) we instead
      // fail closed — an unthrottled admin login surface is a worse outcome than
      // a brief block during a DB incident.
      console.error("[Admin:rate-limit] error:", err.message);
      return options.failClosed === true;
    }
  }

  function getAdminClientIp(request) {
    return extractClientIp(request);
  }

  // POST /admin/auth/forgot-password
  //
  // Public. Always returns 200 with ADMIN_FORGOT_GENERIC_RESPONSE so the
  // endpoint cannot be used to enumerate admin accounts. Side effects (token
  // creation, email send, audit log) happen only when the email actually
  // belongs to an admin AND the email service is configured.
  app.post("/admin/auth/forgot-password", async (request, reply) => {
    const body = request.body || {};
    const rawEmail = typeof body.email === "string" ? body.email : "";
    const normalizedEmail = rawEmail.toLowerCase().trim();
    const clientIp = getAdminClientIp(request);

    // Basic shape gate. Still return the generic 200 so a malformed body
    // can't be used to distinguish "email format invalid" from "email not
    // found" timing-wise.
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !normalizedEmail.includes("@")
    ) {
      return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);
    }

    // Two rate-limit dimensions to make abuse harder:
    //   - per-email: stops mailbox-flooding a specific admin
    //   - per-IP:   stops a single host probing many emails
    const emailLimited = await consumeAdminAuthRateLimit(
      normalizedEmail,
      "admin_forgot_email",
      3,
      60 * 60 * 1000,
    );
    if (emailLimited) return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);

    const ipLimited = await consumeAdminAuthRateLimit(
      clientIp,
      "admin_forgot_ip",
      10,
      60 * 60 * 1000,
    );
    if (ipLimited) return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);

    try {
      const admin = await adminAuthService.findAdminByEmail(normalizedEmail);
      if (admin && emailService && emailService.isConfigured()) {
        const { token, expiresAt } =
          await adminAuthService.createPasswordResetToken(admin.id, {
            ipAddress: clientIp,
          });
        // Send is awaited so failures surface in the error path below
        // (still returning the generic 200). Without await, the request
        // would 200 even when delivery failed silently.
        await emailService.sendAdminPasswordResetEmail(
          normalizedEmail,
          token,
          expiresAt,
        );
        console.log(
          `[Admin:forgot-password] reset email queued for adminId=${admin.id}`,
        );
      } else if (admin && !(emailService && emailService.isConfigured())) {
        // Operational signal: an admin tried to recover but email is off.
        // Generic response still returned to the client; this log is for
        // the admin team to notice and fix the email config.
        console.warn(
          "[Admin:forgot-password] admin exists but email service is not configured — reset email NOT sent",
        );
      }
    } catch (err) {
      // Never leak details to the client. Log for ops.
      console.error("[Admin:forgot-password] error:", err.message);
    }

    return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);
  });

  // POST /admin/auth/reset-password
  //
  // Public. Consumes a single-use reset token, sets the new password, wipes
  // every active admin_sessions row for the admin, invalidates any other
  // outstanding reset tokens for the admin, clears the lockout state, and
  // sends a confirmation email.
  app.post("/admin/auth/reset-password", async (request, reply) => {
    const body = request.body || {};
    const token = typeof body.token === "string" ? body.token : "";
    const newPassword =
      typeof body.new_password === "string" ? body.new_password : "";

    if (!token || !newPassword) {
      return sendError(
        reply,
        400,
        "MISSING_FIELDS",
        "token and new_password are required",
      );
    }
    if (newPassword.length < 12) {
      // Match the threshold used by /admin/auth/change-password so the rule
      // is identical across both entry points.
      return sendError(
        reply,
        400,
        "WEAK_PASSWORD",
        "Password must be at least 12 characters",
      );
    }

    let adminId;
    let tokenId;
    try {
      ({ adminId, tokenId } =
        await adminAuthService.verifyPasswordResetToken(token));
    } catch (_err) {
      // Single generic error response for all token failure modes (not
      // found, expired, already used) so an attacker probing tokens can't
      // distinguish them.
      return sendError(
        reply,
        400,
        "INVALID_TOKEN",
        "Invalid or expired reset link",
      );
    }

    try {
      // Burn the token FIRST so a transient downstream failure can't leave
      // it usable for another ~30min. Worst-case UX on partial failure is
      // "request a new reset link" — better than "your token is still
      // accepted alongside whatever new password just got set."
      await adminAuthService.markPasswordResetTokenUsed(tokenId);
      // Sweep any other still-valid tokens issued to this admin (e.g. a
      // duplicate forgot-password request). Belt-and-suspenders.
      await adminAuthService.invalidateAllPasswordResetTokens(adminId);

      // changePassword updates the password hash AND deletes all
      // admin_sessions rows for the admin, forcing re-login on every
      // device. See admin-auth-service.js:changePassword.
      await adminAuthService.changePassword(adminId, newPassword);

      // Clear failed-login counter + lockout. An admin who got locked out
      // (e.g. via brute-force triggering the threshold) and then reset
      // their password should be able to log in immediately — without
      // this, a successful reset would leave them locked.
      await adminAuthService.clearLockout(adminId);

      // Best-effort security alert. Don't fail the reset if the alert
      // can't be sent (e.g. transient email-provider issue) — the
      // important security action (the password change) has already
      // committed. We catch errors so they don't surface as a 5xx that
      // would leave the client confused about whether the reset took.
      const admin = await adminAuthService.findAdminById(adminId);
      if (admin?.email && emailService && emailService.isConfigured()) {
        emailService
          .sendAdminSecurityAlertEmail(admin.email, {
            event: "password_reset_completed",
          })
          .catch((err) => {
            console.error(
              "[Admin:reset-password] alert send failed:",
              err.message,
            );
          });
      }

      return reply.send({
        success: true,
        message: "Password reset. Please log in.",
      });
    } catch (err) {
      console.error("[Admin:reset-password] error:", err.message);
      return sendError(reply, 500, "RESET_FAILED", "Could not complete reset");
    }
  });

  // --- Blog Publishing CMS ---

  registerAdminBlogRoutes(app, {
    appConfig,
    adminService,
    blogService,
    parsePagination,
    requireAdminSession,
    sendError,
  });

  // --- User Management ---

  registerAdminUserReadRoutes(app, {
    adminService,
    parsePagination,
    requireAdminSession,
    sendError,
  });

  registerAdminUserMutationRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerAdminBillingRoutes(app, {
    adminBillingRepo,
    adminService,
    planConfigService,
    requireAdminRole,
    requireAdminSession,
    sendError,
    subscriptionManager,
    validateReason,
  });

  // --- User Session Management ---

  registerAdminUserSessionControlRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- Metrics ---

  registerAdminMetricsRoutes(app, { adminService, requireAdminSession });

  // --- Jobs ---

  registerAdminJobOpsRoutes(app, {
    adminService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- Moderation ---

  registerAdminModerationRoutes(app, {
    adminService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
    validateReason,
  });

  // --- Story Sessions ---

  registerAdminStorySessionRoutes(app, {
    adminService,
    parsePagination,
    requireAdminSession,
    sendError,
  });

  // --- Share Management ---

  registerAdminShareRoutes(app, {
    adminService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });
  registerAdminWebhookHealthRoutes(app, {
    adminService,
    requireAdminSession,
  });
  registerAdminGrowthRoutes(app, {
    adminService,
    requireAdminSession,
    sendError,
  });
  registerAdminKpiRoutes(app, {
    db,
    requireAdminSession,
  });
  registerAdminAnalyticsRoutes(app, {
    adminService,
    requireAdminSession,
  });

  // --- Gift Operations ---

  registerAdminGiftOpsRoutes(app, {
    db,
    adminGiftOpsService,
    adminService,
    parsePagination,
    requireAdminRole,
    sendError,
  });

  // --- Security Section ---

  registerAdminSecurityObservabilityRoutes(app, {
    adminService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
  });

  registerAdminSecurityConfigRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- Provider Control Plane ---

  registerAdminProviderQueueControlRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- STT Provider Config ---

  registerAdminProviderConfigRoutes(app, {
    appConfig,
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerAdminMusicDiagnosticsRoutes(app, {
    adminService,
    requireAdminSession,
    sendError,
  });

  // --- Feature Flags Config ---

  registerAdminFeatureFlagRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerClientConfigRoutes(app, {
    clientConfigService: publicClientConfigService,
  });

  registerAdminOnboardingSampleRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerAdminBlendAnalysisRoutes(app, {
    adminMusicDiagnosticsRepo,
    appConfig,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- Demo Share Links (Marketing) ---

  registerAdminDemoShareRoutes(app, {
    adminDemoShareRepo,
    adminService,
    appConfig,
    newUuid,
    nowIso,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerAdminMarketingRoutes(app, {
    adminMarketingRepository,
    adminService,
    db,
    newUuid,
    nowIso,
    oneSignalService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // ============ TRACK TRANSFER ============

  registerAdminTrackTransferRoutes(app, {
    adminTrackTransferRepo,
    requireAdminRole,
    sendError,
  });

  registerAdminStaticUiRoutes(app, {
    requireAdminUiAccess,
  });

  return { requireAdminRole };
}

module.exports = { registerAdminRoutes };
