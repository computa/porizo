"use strict";

const fs = require("fs");
const path = require("path");
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
const {
  analyzeBlend,
  formatAnalysisReport,
} = require("../utils/blend-analyzer");
const { newUuid } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const { getClientIp: extractClientIp } = require("../utils/client-ip");
const defaultOneSignalService = require("../services/onesignal");
const { registerAdminAnalyticsRoutes } = require("./admin/analytics");
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
const {
  registerAdminMusicDiagnosticsRoutes,
} = require("./admin/music-diagnostics");
const {
  registerAdminProviderQueueControlRoutes,
} = require("./admin/provider-queue-control");
const {
  registerAdminSecurityObservabilityRoutes,
} = require("./admin/security-observability");
const { registerAdminShareRoutes } = require("./admin/shares");
const {
  registerAdminStorySessionRoutes,
} = require("./admin/story-sessions");
const {
  registerAdminTrackTransferRoutes,
} = require("./admin/track-transfer");
const {
  registerAdminWebhookHealthRoutes,
} = require("./admin/webhook-health");
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
  const MARKETING_CONTACT_STATUSES = ["active", "bounced", "unsubscribed"];
  const ADMIN_STATIC_MIME_TYPES = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
  };
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

  function isValidVersionString(value) {
    return /^\d+(?:\.\d+){0,3}$/.test(value);
  }

  function parseBooleanFilter(value, fieldName, reply) {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "true") return 1;
    if (value === "false") return 0;
    sendError(
      reply,
      400,
      "INVALID_FILTER",
      `${fieldName} must be true or false`,
    );
    return null;
  }

  function getAdminStaticContentType(filePath) {
    return (
      ADMIN_STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream"
    );
  }

  async function sendAdminStaticFile(reply, rootDir, relativePath) {
    const resolvedPath = path.resolve(rootDir, relativePath);
    const relativeToRoot = path.relative(rootDir, resolvedPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return reply.code(403).type("text/plain").send("Forbidden");
    }
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      return reply.code(404).type("text/plain").send("Not Found");
    }
    const content = await fs.promises.readFile(resolvedPath);
    return reply
      .type(getAdminStaticContentType(resolvedPath))
      .header("Cache-Control", "public, max-age=14400")
      .send(content);
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

  app.put("/admin/dashboard/users/:id/entitlements", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const fields = request.body || {};
    const result = await adminService.updateUserEntitlements(
      request.params.id,
      fields,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Admin Complimentary Upgrades ---

  app.post(
    "/admin/dashboard/users/:id/complimentary-upgrade",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { tier, duration_days, reason } = request.body || {};

      if (!tier || !["plus", "pro"].includes(tier)) {
        return sendError(
          reply,
          400,
          "INVALID_TIER",
          "Tier must be 'plus' or 'pro'",
        );
      }
      if (
        !Number.isInteger(duration_days) ||
        duration_days < 1 ||
        duration_days > 365
      ) {
        return sendError(
          reply,
          400,
          "INVALID_DURATION",
          "Duration must be 1-365 days (integer)",
        );
      }
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) return;

      try {
        const result = await subscriptionManager.adminComplimentaryUpgrade(
          request.params.id,
          tier,
          duration_days,
          trimmedReason,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        console.error("[Admin] Complimentary upgrade error:", err);
        sendError(
          reply,
          500,
          "UPGRADE_ERROR",
          "Internal error processing upgrade",
        );
      }
    },
  );

  app.delete(
    "/admin/dashboard/users/:id/complimentary-upgrade",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { reason } = request.body || {};
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) return;

      try {
        const result = await subscriptionManager.revokeComplimentaryUpgrade(
          request.params.id,
          trimmedReason,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        console.error("[Admin] Revoke upgrade error:", err);
        sendError(
          reply,
          500,
          "REVOKE_ERROR",
          "Internal error processing revocation",
        );
      }
    },
  );

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

  app.get("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSecurityConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const config = request.body;

    // Validate required fields and bounds
    const sessionHours = parseInt(config.sessionDurationHours);
    const maxAttempts = parseInt(config.maxFailedLoginAttempts);
    const lockoutMins = parseInt(config.lockoutDurationMinutes);

    if (
      !Number.isInteger(sessionHours) ||
      sessionHours < 1 ||
      sessionHours > 720
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "sessionDurationHours must be between 1 and 720",
      );
      return;
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "maxFailedLoginAttempts must be between 1 and 20",
      );
      return;
    }
    if (
      !Number.isInteger(lockoutMins) ||
      lockoutMins < 1 ||
      lockoutMins > 1440
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "lockoutDurationMinutes must be between 1 and 1440",
      );
      return;
    }
    if (
      config.rateLimitDefaults &&
      typeof config.rateLimitDefaults !== "object"
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "rateLimitDefaults must be an object",
      );
      return;
    }
    if (
      config.iosMinSupportedVersion &&
      !isValidVersionString(String(config.iosMinSupportedVersion).trim())
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosMinSupportedVersion must look like 1.2.3",
      );
      return;
    }
    if (
      config.iosRecommendedVersion &&
      !isValidVersionString(String(config.iosRecommendedVersion).trim())
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosRecommendedVersion must look like 1.2.3",
      );
      return;
    }
    if (
      config.iosUpdateMessage &&
      String(config.iosUpdateMessage).length > 280
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosUpdateMessage must be 280 characters or fewer",
      );
      return;
    }
    if (
      config.iosAutoRecommendedVersion != null &&
      typeof config.iosAutoRecommendedVersion !== "boolean"
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosAutoRecommendedVersion must be true or false",
      );
      return;
    }

    // Sanitize to only allowed fields
    const sanitizedConfig = {
      sessionDurationHours: sessionHours,
      maxFailedLoginAttempts: maxAttempts,
      lockoutDurationMinutes: lockoutMins,
      rateLimitDefaults: config.rateLimitDefaults || {},
      iosMinSupportedVersion: String(
        config.iosMinSupportedVersion || "",
      ).trim(),
      iosRecommendedVersion: String(config.iosRecommendedVersion || "").trim(),
      iosUpdateMessage: String(config.iosUpdateMessage || "").trim(),
      iosAutoRecommendedVersion: Boolean(config.iosAutoRecommendedVersion),
      iosLastAppStoreVersion: String(
        config.iosLastAppStoreVersion || "",
      ).trim(),
      iosLastAppStoreSyncAt: String(config.iosLastAppStoreSyncAt || "").trim(),
      iosAppStoreSyncError: String(config.iosAppStoreSyncError || "").trim(),
    };

    const result = await adminService.updateSecurityConfig(
      sanitizedConfig,
      admin.adminId,
    );
    reply.send(result);
  });

  app.post(
    "/admin/dashboard/security/config/sync-ios-version",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      try {
        const result = await adminService.syncIOSVersionFromAppStore(
          admin.adminId,
          { force: true },
        );
        reply.send(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "App Store Connect sync failed";
        sendError(reply, 502, "APP_STORE_SYNC_FAILED", message);
      }
    },
  );

  // --- Provider Control Plane ---

  registerAdminProviderQueueControlRoutes(app, {
    adminService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- Billing & Revenue ---

  app.get("/admin/dashboard/billing/revenue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const metrics = await adminService.getRevenueMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/billing/subscriptions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getSubscriptionHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/billing/sales", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const sales = await adminService.getBillingSales({
      days: request.query.days || 30,
      limit: request.query.limit,
      offset: request.query.offset,
    });
    reply.send(sales);
  });

  app.get("/admin/dashboard/billing/transactions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { limit, offset } = request.query;
    const transactions = await adminService.getBillingTransactions({
      limit,
      offset,
    });
    reply.send({ transactions });
  });

  // --- STT Provider Config ---

  app.get("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSTTConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { primary_provider, fallback_provider, whisperkit_model } =
      request.body || {};

    try {
      const result = await adminService.setSTTConfig(
        { primary_provider, fallback_provider, whisperkit_model },
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });

  // --- Music Provider Routing Config ---

  app.get("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const config = await adminService.getMusicProviderConfig();
      reply.send({
        ...config,
        available_providers: {
          elevenlabs: Boolean(appConfig.ELEVENLABS_API_KEY),
          suno: Boolean(appConfig.SUNO_API_KEY),
        },
        available_suno_models: ["V4_5", "V5", "V5_5"],
        available_generation_modes: ["composition_plan", "compose_detailed"],
      });
    } catch (err) {
      sendError(
        reply,
        500,
        "MUSIC_CONFIG_ERROR",
        "Failed to load music provider config.",
      );
    }
  });

  app.put("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const {
      default_provider,
      suno_model,
      auto_style_routing,
      elevenlabs_generation_mode,
      auto_reroll_enabled,
      quality_threshold,
      max_rerolls,
      style_overrides,
    } = request.body || {};

    if (
      !request.body ||
      typeof request.body !== "object" ||
      Object.keys(request.body).length === 0
    ) {
      return sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "Request body must contain at least one config key.",
      );
    }

    if (default_provider !== undefined) {
      if (default_provider !== "suno") {
        return sendError(
          reply,
          400,
          "INVALID_CONFIG",
          "default_provider must be suno; ElevenLabs no longer handles song generation.",
        );
      }
    }

    try {
      const result = await adminService.setMusicProviderConfig(
        {
          ...(default_provider !== undefined ? { default_provider } : {}),
          ...(suno_model !== undefined ? { suno_model } : {}),
          ...(auto_style_routing !== undefined ? { auto_style_routing } : {}),
          ...(elevenlabs_generation_mode !== undefined
            ? { elevenlabs_generation_mode }
            : {}),
          ...(auto_reroll_enabled !== undefined ? { auto_reroll_enabled } : {}),
          ...(quality_threshold !== undefined ? { quality_threshold } : {}),
          ...(max_rerolls !== undefined ? { max_rerolls } : {}),
          ...(style_overrides !== undefined ? { style_overrides } : {}),
        },
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
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

  // --- Public App Config (for mobile clients) ---

  app.get("/app/config", async (request, reply) => {
    // Public endpoint - no auth required
    // Returns safe-for-client configuration
    const clientConfig = await publicClientConfigService.getClientConfig();
    reply.send(clientConfig);
  });

  // --- Subscription Plan Management ---

  app.get("/admin/billing/plans", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const plans = await planConfigService.getPlans({ includeInactive: true });
      reply.send({ plans });
    } catch (err) {
      console.error("[Admin] Get plans error:", err);
      sendError(
        reply,
        500,
        "PLANS_ERROR",
        "Failed to load subscription plans.",
      );
    }
  });

  app.put("/admin/billing/plans/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const body = request.body || {};

    // Allowlist and type-validate fields
    const updates = {};
    const intFields = [
      "songs_per_month",
      "poems_per_month",
      "previews_per_day",
      "price_monthly_cents",
      "price_annual_cents",
      "sort_order",
    ];
    for (const field of intFields) {
      if (body[field] !== undefined) {
        const val = parseInt(body[field], 10);
        if (!Number.isInteger(val) || val < 0) {
          sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be a non-negative integer.`,
          );
          return;
        }
        updates[field] = val;
      }
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length === 0 || name.length > 200) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "name must be 1-200 characters.",
        );
        return;
      }
      updates.name = name;
    }
    if (body.description !== undefined) {
      const desc = String(body.description).trim();
      if (desc.length > 500) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "description must be at most 500 characters.",
        );
        return;
      }
      updates.description = desc;
    }
    if (body.is_active !== undefined)
      updates.is_active = Boolean(body.is_active);
    if (body.features_json !== undefined) {
      if (!Array.isArray(body.features_json)) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json must be an array.",
        );
        return;
      }
      if (!body.features_json.every((f) => typeof f === "string")) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json elements must be strings.",
        );
        return;
      }
      if (body.features_json.length > 20) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json must have at most 20 items.",
        );
        return;
      }
      updates.features_json = body.features_json;
    }

    if (Object.keys(updates).length === 0) {
      sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
      return;
    }

    try {
      const updated = await planConfigService.updatePlan(id, updates);
      if (!updated) {
        sendError(reply, 404, "PLAN_NOT_FOUND", "Plan not found.");
        return;
      }

      await adminService._audit(
        admin.adminId,
        "admin_update_plan",
        "subscription_plan",
        id,
        {
          updates,
        },
      );

      reply.send({ plan: updated });
    } catch (err) {
      console.error("[Admin] Update plan error:", err);
      sendError(reply, 500, "PLAN_UPDATE_ERROR", "Failed to update plan.");
    }
  });

  // --- Gift Bundle Management ---

  app.get("/admin/billing/gift-bundles", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const bundles = await adminBillingRepo.listGiftBundlesForAdmin();
      reply.send({ bundles });
    } catch (err) {
      console.error("[Admin] Get gift bundles error:", err);
      sendError(reply, 500, "GIFT_BUNDLES_ERROR", err.message);
    }
  });

  app.put("/admin/billing/gift-bundles/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const updates = request.body || {};

    const allowedFields = [
      "token_count",
      "display_name",
      "description",
      "is_active",
      "sort_order",
    ];
    const filteredUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
      return;
    }

    // Validate token_count
    if (filteredUpdates.token_count !== undefined) {
      const tc = parseInt(filteredUpdates.token_count, 10);
      if (!Number.isInteger(tc) || tc < 1 || tc > 10) {
        sendError(
          reply,
          400,
          "INVALID_TOKEN_COUNT",
          "token_count must be an integer between 1 and 10.",
        );
        return;
      }
      filteredUpdates.token_count = tc;
    }

    // Validate sort_order
    if (filteredUpdates.sort_order !== undefined) {
      const so = parseInt(filteredUpdates.sort_order, 10);
      if (!Number.isInteger(so) || so < 0) {
        sendError(
          reply,
          400,
          "INVALID_SORT_ORDER",
          "sort_order must be a non-negative integer.",
        );
        return;
      }
      filteredUpdates.sort_order = so;
    }

    try {
      // Fetch previous values for audit
      const previous = await adminBillingRepo.getGiftBundleById(id);
      if (!previous) {
        sendError(reply, 404, "BUNDLE_NOT_FOUND", "Gift bundle not found.");
        return;
      }

      await adminBillingRepo.updateGiftBundleFields({
        id,
        updates: filteredUpdates,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.adminId,
      });

      // Audit with previous + new values
      await adminService._audit(
        admin.adminId,
        "admin_update_gift_bundle",
        "gift_bundle",
        id,
        {
          previous: {
            token_count: previous.token_count,
            display_name: previous.display_name,
            is_active: previous.is_active,
            sort_order: previous.sort_order,
          },
          updated: filteredUpdates,
        },
      );

      const updated = await adminBillingRepo.getGiftBundleById(id);
      reply.send({ success: true, bundle: updated });
    } catch (err) {
      request.log.error({ err }, "[Admin] Update gift bundle error");
      sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
    }
  });

  // --- Onboarding Samples Management ---

  app.get("/admin/dashboard/onboarding-samples", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const samples = await adminService.getOnboardingSamples();
      reply.send({ samples });
    } catch (err) {
      request.log.error({ err }, "[Admin] Get onboarding samples error");
      sendError(reply, 500, "ONBOARDING_SAMPLES_ERROR", err.message);
    }
  });

  app.post("/admin/dashboard/onboarding-samples", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { label, audio_url } = request.body || {};

    try {
      const sample = await adminService.createOnboardingSample(
        { label, audio_url },
        admin.adminId,
      );
      reply.send({ success: true, sample });
    } catch (err) {
      if (
        err.message.includes("is required") ||
        err.message.includes("must start with") ||
        err.message.includes("must be")
      ) {
        sendError(reply, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      request.log.error({ err }, "[Admin] Create onboarding sample error");
      sendError(reply, 500, "CREATE_ERROR", "An internal error occurred.");
    }
  });

  app.put("/admin/dashboard/onboarding-samples/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const updates = request.body || {};

    try {
      const sample = await adminService.updateOnboardingSample(
        id,
        updates,
        admin.adminId,
      );
      reply.send({ success: true, sample });
    } catch (err) {
      if (err.message === "Onboarding sample not found") {
        sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
        return;
      }
      if (
        err.message.includes("No valid fields") ||
        err.message.includes("must start with") ||
        err.message.includes("must be")
      ) {
        sendError(reply, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      request.log.error({ err }, "[Admin] Update onboarding sample error");
      sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
    }
  });

  app.put(
    "/admin/dashboard/onboarding-samples/:id/activate",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { id } = request.params;

      try {
        const sample = await adminService.activateOnboardingSample(
          id,
          admin.adminId,
        );
        reply.send({ success: true, sample });
      } catch (err) {
        if (err.message === "Onboarding sample not found") {
          sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
          return;
        }
        request.log.error({ err }, "[Admin] Activate onboarding sample error");
        sendError(reply, 500, "ACTIVATE_ERROR", "An internal error occurred.");
      }
    },
  );

  app.delete(
    "/admin/dashboard/onboarding-samples/:id",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { id } = request.params;

      try {
        const result = await adminService.deleteOnboardingSample(
          id,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        if (err.message === "Onboarding sample not found") {
          sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
          return;
        }
        request.log.error({ err }, "[Admin] Delete onboarding sample error");
        sendError(reply, 500, "DELETE_ERROR", "An internal error occurred.");
      }
    },
  );

  // --- Blend Analysis (Voice Conversion Diagnostics) ---
  /**
   * Analyze a track's blend quality to diagnose voice conversion issues
   * POST /admin/dashboard/analyze-blend
   *
   * Body:
   * - trackVersionId: string (required) - The track version to analyze
   * - includeReport: boolean (optional) - Include formatted text report
   */
  app.post("/admin/dashboard/analyze-blend", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { trackVersionId, includeReport } = request.body || {};
    if (!trackVersionId) {
      return sendError(
        reply,
        400,
        "INVALID_REQUEST",
        "trackVersionId is required",
      );
    }

    try {
      // Get track version details to find file paths
      const trackVersion =
        await adminMusicDiagnosticsRepo.findTrackVersionBlendContext(
          trackVersionId,
        );

      if (!trackVersion) {
        return sendError(reply, 404, "NOT_FOUND", "Track version not found");
      }

      const userId = trackVersion.user_id;
      const trackId = trackVersion.track_id;
      const version = trackVersion.version_num;

      // Build file paths based on storage layout
      const basePath = path.join(
        process.cwd(),
        "storage/tracks",
        userId,
        trackId,
        `v${version}`,
      );

      const filePaths = {
        userEnrollmentPath: null, // Will try to find from voice profile
        originalVocalPath: path.join(basePath, "stems/vocals.wav"),
        convertedVocalPath: path.join(basePath, "user_vocal.wav"),
        blendedOutputPath: path.join(basePath, "blended_vocal.wav"),
      };

      // Try to find user's enrollment audio
      const voiceProfile =
        await adminMusicDiagnosticsRepo.findLatestActiveVoiceProfileForUser(
          userId,
        );

      if (voiceProfile) {
        // Try to find enrollment audio in S3 or local storage
        const enrollmentBasePath = path.join(
          process.cwd(),
          "storage/enrollment/raw",
          userId,
        );
        if (fs.existsSync(enrollmentBasePath)) {
          const sessions = fs.readdirSync(enrollmentBasePath);
          if (sessions.length > 0) {
            const sessionPath = path.join(enrollmentBasePath, sessions[0]);
            const chunks = fs
              .readdirSync(sessionPath)
              .filter((f) => f.endsWith(".wav"));
            if (chunks.length > 0) {
              // Prefer sung chunks for voice comparison
              const sungChunk =
                chunks.find((c) => c.includes("sung")) || chunks[0];
              filePaths.userEnrollmentPath = path.join(sessionPath, sungChunk);
            }
          }
        }
      }

      // Check which files exist
      const existingFiles = {};
      for (const [key, filePath] of Object.entries(filePaths)) {
        if (filePath && fs.existsSync(filePath)) {
          existingFiles[key] = filePath;
        }
      }

      if (Object.keys(existingFiles).length === 0) {
        return sendError(
          reply,
          404,
          "NO_FILES_FOUND",
          "No audio files found for analysis. Files may have been cleaned up or render incomplete.",
        );
      }

      // Run analysis
      const analysis = await analyzeBlend(existingFiles);

      // Add track context
      analysis.trackContext = {
        trackVersionId,
        trackId,
        userId,
        version,
        filesAnalyzed: Object.keys(existingFiles),
        filesMissing: Object.keys(filePaths).filter((k) => !existingFiles[k]),
      };

      // Optionally include formatted report
      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", "Failed to analyze blend");
    }
  });

  /**
   * Quick blend analysis from file paths (for CLI/testing)
   * POST /admin/dashboard/analyze-blend/paths
   */
  app.post("/admin/dashboard/analyze-blend/paths", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const {
      userEnrollmentPath,
      originalVocalPath,
      convertedVocalPath,
      blendedOutputPath,
      includeReport,
    } = request.body || {};

    // Validate all paths are within STORAGE_DIR (prevent arbitrary file read)
    const storageRoot = path.resolve(appConfig.STORAGE_DIR) + path.sep;
    const paths = {
      userEnrollmentPath,
      originalVocalPath,
      convertedVocalPath,
      blendedOutputPath,
    };
    const existingPaths = {};
    for (const [key, filePath] of Object.entries(paths)) {
      if (!filePath) continue;
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(storageRoot)) {
        return sendError(
          reply,
          400,
          "INVALID_PATH",
          `Path "${key}" must be within storage directory`,
        );
      }
      if (fs.existsSync(resolved)) {
        existingPaths[key] = resolved;
      }
    }

    if (Object.keys(existingPaths).length === 0) {
      return sendError(
        reply,
        400,
        "NO_FILES",
        "No valid file paths provided or files don't exist",
      );
    }

    try {
      const analysis = await analyzeBlend(existingPaths);

      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", "Failed to analyze blend");
    }
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

  // --- Marketing ---

  // RFC 4180 CSV parser with quoted-field support
  function parseCsvRow(line) {
    const cols = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          cols.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cols.push(current.trim());
    return cols;
  }

  // Read and validate a CSV file upload, returning { lines, filename }
  async function readCsvUpload(
    request,
    reply,
    { maxSizeMB = 2, maxRows = 10000 } = {},
  ) {
    const data = await request.file();
    if (!data) {
      sendError(reply, 400, "NO_FILE", "No file uploaded");
      return null;
    }

    const mime = data.mimetype;
    if (
      mime !== "text/csv" &&
      mime !== "application/vnd.ms-excel" &&
      mime !== "application/octet-stream"
    ) {
      sendError(reply, 400, "INVALID_FILE_TYPE", "Only CSV files are accepted");
      return null;
    }

    const maxSize = maxSizeMB * 1024 * 1024;
    const chunks = [];
    let size = 0;
    for await (const chunk of data.file) {
      size += chunk.length;
      if (size > maxSize) {
        sendError(
          reply,
          400,
          "FILE_TOO_LARGE",
          `CSV must be under ${maxSizeMB}MB`,
        );
        return null;
      }
      chunks.push(chunk);
    }

    const csvText = Buffer.concat(chunks).toString("utf8");
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      sendError(reply, 400, "EMPTY_CSV", "CSV has no data rows");
      return null;
    }
    if (maxRows && lines.length > maxRows + 1) {
      sendError(
        reply,
        400,
        "TOO_MANY_ROWS",
        `CSV must have fewer than ${maxRows.toLocaleString()} rows`,
      );
      return null;
    }

    return { lines, filename: data.filename || "unknown.csv" };
  }

  // Normalize email from multiple possible header names
  function normalizeEmail(record) {
    return (
      (record.email || record.emailaddress || record.email_address || "")
        .trim()
        .toLowerCase() || null
    );
  }

  // OWASP formula injection prevention for CSV export cells
  function sanitizeCsvCell(val) {
    if (!val) return "";
    const s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  const TEMPLATE_ALLOWLIST = [
    {
      id: "email-1-introduction",
      file: "email-1-introduction.html",
      subject: "What if your favorite memory became a song?",
      label: "The Introduction",
      day: "Day 0",
    },
    {
      id: "email-2-social-proof",
      file: "email-2-social-proof.html",
      subject: "Re: The gift no one expects",
      label: "The Social Proof",
      day: "Day 3",
    },
    {
      id: "email-3-final-nudge",
      file: "email-3-final-nudge.html",
      subject: "Someone's birthday is coming up",
      label: "The Final Nudge",
      day: "Day 8",
    },
  ];

  const CAMPAIGN_TYPES = ["email", "push", "social", "partnership"];
  const CAMPAIGN_STATUSES = ["draft", "scheduled", "sent", "completed"];
  const MAX_PUSH_TITLE_LENGTH = 80;
  const MAX_PUSH_BODY_LENGTH = 180;

  function validateCampaignFields({ type, status, template_id }, reply) {
    if (type && !CAMPAIGN_TYPES.includes(type)) {
      sendError(
        reply,
        400,
        "INVALID_TYPE",
        `Type must be one of: ${CAMPAIGN_TYPES.join(", ")}`,
      );
      return false;
    }
    if (status && !CAMPAIGN_STATUSES.includes(status)) {
      sendError(
        reply,
        400,
        "INVALID_STATUS",
        `Status must be one of: ${CAMPAIGN_STATUSES.join(", ")}`,
      );
      return false;
    }
    if (template_id && !TEMPLATE_ALLOWLIST.some((t) => t.id === template_id)) {
      sendError(reply, 400, "INVALID_TEMPLATE", "Invalid template ID");
      return false;
    }
    return true;
  }

  function normalizePushText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeOneSignalSegments({ segment, segments }) {
    const rawSegments = Array.isArray(segments) ? segments : [segment || "All"];
    return rawSegments
      .map((item) => normalizePushText(item))
      .filter(Boolean)
      .slice(0, 10);
  }

  function normalizeUserIds(userIds) {
    if (!Array.isArray(userIds)) return [];
    return userIds
      .map((item) => normalizePushText(item))
      .filter(Boolean)
      .slice(0, 1000);
  }

  function oneSignalRecipientCount(response) {
    const candidates = [response?.recipients, response?.successful];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return 0;
  }

  const COLD_EMAIL_TEMPLATES = [
    {
      id: "cold-intro",
      file: "cold-intro.html",
      subject: "A song from one memory",
      label: "Cold Intro",
      day: "Day 0 (active)",
    },
    {
      id: "completed-before",
      file: "completed-before.html",
      subject: "Your song's still here",
      label: "Completed Before",
      day: "Re-engagement",
    },
    {
      id: "no-song",
      file: "no-song.html",
      subject: "Almost gave you a song",
      label: "No Song",
      day: "Re-engagement",
    },
  ];
  const coldEmailSvc = require("../services/cold-email-service");

  app.get(
    "/admin/dashboard/marketing/email-templates",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const nurtureDir = path.join(process.cwd(), "marketing", "emails");
      const coldDir = path.join(process.cwd(), "marketing", "email");

      const readGroup = async (dir, list) =>
        Promise.all(
          list.map(async (tpl) => {
            try {
              const html = await fs.promises.readFile(
                path.join(dir, tpl.file),
                "utf8",
              );
              return { ...tpl, html };
            } catch {
              return { ...tpl, html: null, error: "File not found" };
            }
          }),
        );

      // Any template_html_path referenced by an actual campaign that
      // ISN'T in the static COLD_EMAIL_TEMPLATES list is surfaced with
      // {custom: true} so operators see what's actually being sent —
      // not just what the static list documents.
      const knownColdPaths = new Set(
        COLD_EMAIL_TEMPLATES.map((tpl) => `marketing/email/${tpl.file}`),
      );
      const referenced = await coldEmailSvc.listTemplateReferences(db);
      const customSpecs = [];
      for (const row of referenced ?? []) {
        if (!row?.html_path) continue;
        if (knownColdPaths.has(row.html_path)) continue;
        const file = row.html_path.replace(/^marketing\/email\//, "");
        customSpecs.push({
          id: `custom:${file}`,
          file,
          subject: "(custom template)",
          label: `Custom · ${file}`,
          day: "Custom",
          custom: true,
        });
      }

      const [templates, standardCold, customCold] = await Promise.all([
        readGroup(nurtureDir, TEMPLATE_ALLOWLIST),
        readGroup(coldDir, COLD_EMAIL_TEMPLATES),
        readGroup(coldDir, customSpecs),
      ]);
      reply.send({
        templates,
        cold_email_templates: [...standardCold, ...customCold],
      });
    },
  );

  app.get("/admin/dashboard/marketing/contacts", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { limit, offset } = parsePagination(request.query);
    const { search, category, status } = request.query;
    if (status && !MARKETING_CONTACT_STATUSES.includes(status)) {
      return sendError(
        reply,
        400,
        "INVALID_STATUS",
        `Status must be one of: ${MARKETING_CONTACT_STATUSES.join(", ")}`,
      );
    }

    const { contacts, total } = await adminMarketingRepository.listContacts({
      search,
      category,
      status,
      limit,
      offset,
    });

    reply.send({ contacts, total, limit, offset });
  });

  app.post(
    "/admin/dashboard/marketing/contacts/upload",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const csv = await readCsvUpload(request, reply, {
        maxSizeMB: 2,
        maxRows: 10000,
      });
      if (!csv) return;

      const { lines, filename } = csv;

      const KNOWN_HEADERS = new Set([
        "first_name",
        "last_name",
        "company_name",
        "name",
        "website",
        "description",
        "contact_name",
        "email",
        "emailaddress",
        "email_address",
        "category",
        "channel_type",
        "score",
        "icp_fit_score",
        "icp_fit_reasoning",
        "audience_reach",
        "partnership_opportunity",
        "contact_approach",
      ]);

      const headers = parseCsvRow(lines[0]).map((h) =>
        h.trim().toLowerCase().replace(/\s+/g, "_"),
      );
      const rows = lines.slice(1);

      const now = nowIso();
      const importRows = rows.map((row) => {
        const cols = parseCsvRow(row);
        // Build record from known headers only (prevents prototype pollution)
        const record = Object.create(null);
        headers.forEach((h, i) => {
          if (KNOWN_HEADERS.has(h)) record[h] = cols[i] || null;
        });

        const email = normalizeEmail(record);
        const firstName = record.first_name || null;
        const lastName = record.last_name || null;
        const companyName = record.company_name || record.name || null;
        let website = record.website || null;
        // Derive contact_name from first+last if not explicitly provided
        const contactName =
          record.contact_name ||
          (firstName && lastName
            ? `${firstName} ${lastName}`
            : firstName || lastName || null);

        // Sanitize URL — only allow http(s) schemes
        if (website && !/^https?:\/\//i.test(website)) {
          website = null;
        }

        return {
          id: newUuid(),
          firstName,
          lastName,
          companyName,
          website,
          description: record.description || null,
          contactName,
          email,
          category: record.category || record.channel_type || null,
          score: parseInt(record.score || record.icp_fit_score) || 0,
          icpFitReasoning: record.icp_fit_reasoning || null,
          audienceReach: record.audience_reach || null,
          partnershipOpportunity: record.partnership_opportunity || null,
          contactApproach: record.contact_approach || null,
          sourceFile: filename,
        };
      });

      const { inserted, skipped } =
        await adminMarketingRepository.importContactsTransaction({
          rows: importRows,
          now,
        });

      await adminService._audit(
        admin.adminId,
        "marketing_contacts_upload",
        "marketing_contacts",
        null,
        {
          filename,
          inserted,
          skipped,
          total_rows: rows.length,
        },
      );

      reply.send({ success: true, inserted, skipped, total: rows.length });
    },
  );

  app.get("/admin/dashboard/marketing/campaigns", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const campaigns = await adminMarketingRepository.listCampaigns();
    reply.send({ campaigns });
  });

  // ===== Cold-email campaigns =====
  // Replaces the old launchd/Python job. Read-only observability + manual
  // trigger. Trigger requires superadmin because each call schedules real
  // outbound emails to a cold list — irreversible side effect.
  const COLD_EMAIL_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  app.get("/admin/dashboard/marketing/cold-email", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const active = await coldEmailSvc.listActiveCampaigns(db);
    const all = await coldEmailSvc.listAllCampaigns(db);
    const byId = new Map(active.map((c) => [c.id, c.pending_count]));
    const campaigns = all.map((c) => ({
      ...c,
      pending_count: byId.get(c.id) ?? 0,
    }));
    reply.send({ campaigns });
  });

  app.post(
    "/admin/dashboard/marketing/cold-email/:id/trigger",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const id = request.params.id;
      if (!COLD_EMAIL_ID_PATTERN.test(id)) {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_ID",
          "Campaign id must match [a-zA-Z0-9_-]{1,64}",
        );
      }
      const campaign = await coldEmailSvc.loadCampaign(db, id);
      if (!campaign) {
        return sendError(
          reply,
          404,
          "CAMPAIGN_NOT_FOUND",
          `No cold_email_campaigns row '${id}'`,
        );
      }
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return sendError(
          reply,
          503,
          "RESEND_KEY_MISSING",
          "RESEND_API_KEY not set",
        );
      }
      try {
        const result = await coldEmailSvc.processCampaign(db, campaign, {
          apiKey,
          now: new Date(),
          log: (msg) => app.log.info(msg),
        });
        try {
          await adminService._audit(
            admin.adminId,
            "cold_email_manual_trigger",
            "cold_email_campaigns",
            id,
            {
              fired: result.fired,
              queued: result.queued ?? 0,
              attempted: result.attempted ?? 0,
              reason: result.reason ?? null,
              from_address: campaign.from_address,
              subject: campaign.subject,
            },
          );
        } catch (auditErr) {
          app.log.error(auditErr, "cold-email trigger audit log failed");
        }
        if (!result.fired) {
          return reply.code(409).send({
            fired: false,
            reason: result.reason,
          });
        }
        reply.send({
          fired: true,
          queued: result.queued,
          attempted: result.attempted,
        });
      } catch (err) {
        app.log.error(err, "cold-email manual trigger failed");
        sendError(
          reply,
          502,
          "RESEND_FAILED",
          "Resend batch submission failed",
        );
      }
    },
  );

  app.patch(
    "/admin/dashboard/marketing/cold-email/:id",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const id = request.params.id;
      if (!COLD_EMAIL_ID_PATTERN.test(id)) {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_ID",
          "Campaign id must match [a-zA-Z0-9_-]{1,64}",
        );
      }
      const existing = await coldEmailSvc.loadCampaign(db, id);
      if (!existing) {
        return sendError(
          reply,
          404,
          "CAMPAIGN_NOT_FOUND",
          `No cold_email_campaigns row '${id}'`,
        );
      }

      // NOTE: Keep these whitelists in sync with admin/src/pages/marketing/
      // ColdEmailTab.tsx EDITABLE_FIELDS — frontend renders one form input
      // per allowed field, server is the authoritative validator.
      const body = request.body || {};
      const allowedString = {
        subject: { maxLen: 200, kind: "text" },
        campaign_tag: { maxLen: 80, kind: "text" },
        from_address: { maxLen: 200, kind: "email" },
        reply_to: { maxLen: 200, kind: "email" },
      };
      const allowedInt = {
        per_day: [1, 100],
        schedule_pace_seconds: [30, 3600],
        schedule_offset_minutes: [0, 600],
        fire_after_utc_hour: [0, 23],
        fire_until_utc_hour: [1, 24],
        min_minutes_between_runs: [1, 1440],
        active: [0, 1],
      };

      // RFC 5322 single-mailbox shape, optional display name. Rejects CR/LF
      // so a wrong-value PATCH can't smuggle headers into the Resend payload.
      const EMAIL_LIKE_RE =
        /^([^<>\r\n]{0,80}<)?[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+>?$/;

      const changes = {};
      const changedFields = [];

      for (const [field, spec] of Object.entries(allowedString)) {
        if (!(field in body)) continue;
        const raw = body[field];
        if (typeof raw !== "string" || raw.length > spec.maxLen) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be a string up to ${spec.maxLen} chars`,
          );
        }
        const value = raw.trim();
        if (value.length === 0) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must not be blank`,
          );
        }
        if (/[\r\n\0]/.test(value)) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must not contain control characters`,
          );
        }
        if (spec.kind === "email" && !EMAIL_LIKE_RE.test(value)) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must look like 'name@example.com' or 'Name <name@example.com>'`,
          );
        }
        changes[field] = value;
        changedFields.push(field);
      }

      for (const [field, [min, max]] of Object.entries(allowedInt)) {
        if (!(field in body)) continue;
        const value = body[field];
        if (!Number.isInteger(value) || value < min || value > max) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be an integer in [${min}, ${max}]`,
          );
        }
        changes[field] = value;
        changedFields.push(field);
      }

      if ("earliest_run_date_utc" in body) {
        const value = body.earliest_run_date_utc;
        if (value !== null) {
          if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return sendError(
              reply,
              400,
              "INVALID_FIELD",
              "earliest_run_date_utc must be YYYY-MM-DD or null",
            );
          }
          // Roundtrip check rejects 2026-13-99, 2026-02-31, etc.
          const dt = new Date(`${value}T00:00:00Z`);
          if (
            Number.isNaN(dt.getTime()) ||
            dt.toISOString().slice(0, 10) !== value
          ) {
            return sendError(
              reply,
              400,
              "INVALID_FIELD",
              "earliest_run_date_utc must be a real calendar date",
            );
          }
        }
        changes.earliest_run_date_utc = value;
        changedFields.push("earliest_run_date_utc");
      }

      if (changedFields.length === 0) {
        return sendError(
          reply,
          400,
          "NO_UPDATES",
          "No editable fields supplied",
        );
      }

      // Cross-field: fire_until_utc_hour must be strictly greater than
      // fire_after_utc_hour, else the daily window is empty and the campaign
      // silently never fires. Resolve effective values against the
      // patched-or-existing campaign (the patch is partial).
      const effectiveAfter =
        "fire_after_utc_hour" in body
          ? body.fire_after_utc_hour
          : existing.fire_after_utc_hour;
      const effectiveUntil =
        "fire_until_utc_hour" in body
          ? body.fire_until_utc_hour
          : existing.fire_until_utc_hour;
      if (
        Number.isInteger(effectiveAfter) &&
        Number.isInteger(effectiveUntil) &&
        effectiveUntil <= effectiveAfter
      ) {
        return sendError(
          reply,
          400,
          "INVALID_WINDOW",
          `fire_until_utc_hour (${effectiveUntil}) must be greater than fire_after_utc_hour (${effectiveAfter}) — otherwise the daily window is empty.`,
        );
      }

      // Optimistic concurrency: require If-Match against current updated_at.
      // Bypassed if the client doesn't send it (legacy curl callers), but
      // strongly recommended for the admin UI to surface stale-form-state
      // conflicts to the operator.
      const ifMatch =
        request.headers["if-match"] ??
        request.headers["If-Match"] ??
        body.if_match ??
        body.updated_at;
      if (ifMatch && ifMatch !== existing.updated_at) {
        return reply.code(409).send({
          error: "STALE_UPDATE",
          message:
            "Campaign was modified by another writer. Refresh to see the latest state and retry.",
          current_updated_at: existing.updated_at,
        });
      }

      const nowIso = new Date().toISOString();
      const updatedCampaign = await coldEmailSvc.updateCampaignFields(
        db,
        id,
        changes,
        existing.updated_at ?? "",
        nowIso,
      );
      if (!updatedCampaign) {
        // Lost the race after the If-Match check (another PATCH landed
        // between our load and our UPDATE). Surface the conflict.
        return reply.code(409).send({
          error: "STALE_UPDATE",
          message:
            "Campaign was modified by another writer between read and write. Refresh and retry.",
        });
      }

      const updated = await coldEmailSvc.loadCampaign(db, id);

      try {
        const before = {};
        const after = {};
        for (const f of changedFields) {
          before[f] = existing[f];
          after[f] = updated[f];
        }
        await adminService._audit(
          admin.adminId,
          "cold_email_campaign_update",
          "cold_email_campaigns",
          id,
          { before, after },
        );
      } catch (auditErr) {
        app.log.error(auditErr, "cold-email PATCH audit log failed");
      }

      reply.send({ campaign: updated });
    },
  );

  app.post("/admin/dashboard/marketing/campaigns", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { name, type, status, template_id, sent_at, recipient_count, notes } =
      request.body || {};
    if (!name || !name.trim()) {
      return sendError(reply, 400, "MISSING_NAME", "Campaign name is required");
    }
    if (name.trim().length > 200) {
      return sendError(
        reply,
        400,
        "NAME_TOO_LONG",
        "Campaign name must not exceed 200 characters",
      );
    }
    if (notes && notes.length > 2000) {
      return sendError(
        reply,
        400,
        "NOTES_TOO_LONG",
        "Notes must not exceed 2,000 characters",
      );
    }
    if (!validateCampaignFields({ type, status, template_id }, reply)) return;
    if (
      recipient_count != null &&
      (recipient_count < 0 || recipient_count > 1000000)
    ) {
      return sendError(
        reply,
        400,
        "INVALID_COUNT",
        "Recipient count must be 0-1,000,000",
      );
    }
    if (sent_at && isNaN(new Date(sent_at).getTime())) {
      return sendError(
        reply,
        400,
        "INVALID_DATE",
        "sent_at must be a valid ISO date",
      );
    }

    const id = newUuid();
    const now = nowIso();
    const campaign = await adminMarketingRepository.createCampaign({
      id,
      name: name.trim(),
      type: type || "email",
      status: status || "draft",
      templateId: template_id || null,
      sentAt: sent_at || null,
      recipientCount: recipient_count || 0,
      notes: notes || null,
      now,
    });

    await adminService._audit(
      admin.adminId,
      "marketing_campaign_create",
      "marketing_campaigns",
      id,
      { name: name.trim() },
    );

    reply.send({ campaign });
  });

  app.put(
    "/admin/dashboard/marketing/campaigns/:id",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const existing = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      if (!existing) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }

      const {
        name,
        type,
        status,
        template_id,
        sent_at,
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
        notes,
      } = request.body || {};

      if (name !== undefined && name.trim().length > 200) {
        return sendError(
          reply,
          400,
          "NAME_TOO_LONG",
          "Campaign name must not exceed 200 characters",
        );
      }
      if (notes !== undefined && notes && notes.length > 2000) {
        return sendError(
          reply,
          400,
          "NOTES_TOO_LONG",
          "Notes must not exceed 2,000 characters",
        );
      }
      if (!validateCampaignFields({ type, status, template_id }, reply)) return;
      if (sent_at && isNaN(new Date(sent_at).getTime())) {
        return sendError(
          reply,
          400,
          "INVALID_DATE",
          "sent_at must be a valid ISO date",
        );
      }

      // Validate numeric stats
      const stats = {
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
      };
      for (const [key, val] of Object.entries(stats)) {
        if (
          val != null &&
          (val < 0 || val > 1000000 || !Number.isInteger(val))
        ) {
          return sendError(
            reply,
            400,
            "INVALID_STAT",
            `${key} must be a non-negative integer up to 1,000,000`,
          );
        }
      }

      // Build update set from provided fields (allowlisted columns only)
      const ALLOWED_COLUMNS = [
        "name",
        "type",
        "status",
        "template_id",
        "sent_at",
        "recipient_count",
        "opens",
        "clicks",
        "replies",
        "bounces",
        "unsubscribes",
        "notes",
      ];
      const candidates = {
        name: name?.trim(),
        type,
        status,
        template_id,
        sent_at,
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
        notes,
      };
      const updates = {};
      for (const [k, v] of Object.entries(candidates)) {
        if (v !== undefined) {
          if (!ALLOWED_COLUMNS.includes(k)) continue;
          updates[k] = v;
        }
      }

      if (Object.keys(updates).length === 0) {
        return sendError(reply, 400, "NO_CHANGES", "No fields to update");
      }

      updates.updated_at = nowIso();
      await adminMarketingRepository.updateCampaign(request.params.id, updates);

      await adminService._audit(
        admin.adminId,
        "marketing_campaign_update",
        "marketing_campaigns",
        request.params.id,
        {
          fields_changed: Object.keys(updates).filter(
            (k) => k !== "updated_at",
          ),
        },
      );

      const campaign = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      reply.send({ campaign });
    },
  );

  app.post(
    "/admin/dashboard/marketing/campaigns/:id/send-push",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, [
        "admin",
        "superadmin",
      ]);
      if (!admin) return;

      const campaign = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }
      if (campaign.type !== "push") {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_TYPE",
          "Only push campaigns can be sent through OneSignal",
        );
      }
      if (!oneSignalService.isConfigured()) {
        return sendError(
          reply,
          503,
          "ONESIGNAL_NOT_CONFIGURED",
          "OneSignal credentials are not configured",
        );
      }

      const title = normalizePushText(request.body?.title);
      const body = normalizePushText(request.body?.body);
      const imageUrl =
        normalizePushText(request.body?.image_url || request.body?.imageUrl) ||
        null;
      const dryRun =
        request.body?.dry_run === true || request.body?.dryRun === true;
      const segments = normalizeOneSignalSegments(request.body || {});
      const userIds = normalizeUserIds(
        request.body?.user_ids || request.body?.userIds,
      );

      if (!title) {
        return sendError(reply, 400, "MISSING_TITLE", "Push title is required");
      }
      if (!body) {
        return sendError(reply, 400, "MISSING_BODY", "Push body is required");
      }
      if (title.length > MAX_PUSH_TITLE_LENGTH) {
        return sendError(
          reply,
          400,
          "TITLE_TOO_LONG",
          `Push title must not exceed ${MAX_PUSH_TITLE_LENGTH} characters`,
        );
      }
      if (body.length > MAX_PUSH_BODY_LENGTH) {
        return sendError(
          reply,
          400,
          "BODY_TOO_LONG",
          `Push body must not exceed ${MAX_PUSH_BODY_LENGTH} characters`,
        );
      }
      if (userIds.length === 0 && segments.length === 0) {
        return sendError(
          reply,
          400,
          "MISSING_TARGET",
          "At least one segment or user ID is required",
        );
      }
      if (
        request.body?.data &&
        (typeof request.body.data !== "object" ||
          Array.isArray(request.body.data))
      ) {
        return sendError(
          reply,
          400,
          "INVALID_DATA",
          "Push data must be an object",
        );
      }

      const pushData = {
        ...(request.body?.data || {}),
        campaign_id: campaign.id,
        campaign_name: campaign.name,
      };
      const target =
        userIds.length > 0
          ? { type: "users", user_ids: userIds }
          : { type: "segments", segments };

      if (dryRun) {
        return reply.send({
          success: true,
          dry_run: true,
          configured: true,
          target,
          title,
          body,
        });
      }

      if (request.body?.confirm !== "SEND_PUSH") {
        return sendError(
          reply,
          400,
          "CONFIRMATION_REQUIRED",
          "Set confirm to SEND_PUSH before sending a live push",
        );
      }

      let response;
      try {
        response =
          userIds.length > 0
            ? await oneSignalService.sendToUsers({
                userIds,
                title,
                body,
                data: pushData,
                imageUrl,
                name: campaign.name,
              })
            : await oneSignalService.sendToSegment({
                segments,
                title,
                body,
                data: pushData,
                imageUrl,
                name: campaign.name,
              });
      } catch (err) {
        request.log?.error(
          { err, campaignId: campaign.id },
          "OneSignal push send failed",
        );
        return sendError(
          reply,
          err.status || 502,
          "ONESIGNAL_SEND_FAILED",
          "OneSignal rejected the push send request",
        );
      }

      const sentAt = nowIso();
      const recipients = oneSignalRecipientCount(response);
      const targetLabel =
        userIds.length > 0 ? `users:${userIds.length}` : segments.join(",");

      const updated = await adminMarketingRepository.recordPushSend({
        pushCampaignId: newUuid(),
        campaignId: campaign.id,
        campaignName: campaign.name,
        targetLabel,
        title,
        body,
        dataJson: JSON.stringify(pushData),
        imageUrl,
        notificationId: response.id || null,
        sentAt,
        recipients,
      });

      await adminService._audit(
        admin.adminId,
        "marketing_push_send",
        "marketing_campaigns",
        campaign.id,
        {
          onesignal_notification_id: response.id || null,
          recipients,
          target,
        },
      );

      reply.send({
        success: true,
        campaign: updated,
        onesignal: {
          id: response.id || null,
          recipients,
        },
      });
    },
  );

  // --- Import GMass Results ---
  app.post(
    "/admin/dashboard/marketing/campaigns/:id/import-results",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const campaign = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }
      if (!["sent", "completed"].includes(campaign.status)) {
        return sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Can only import results for sent or completed campaigns",
        );
      }

      const csv = await readCsvUpload(request, reply, {
        maxSizeMB: 5,
        maxRows: 50000,
      });
      if (!csv) return;

      const { lines, filename } = csv;

      const GMASS_HEADERS = new Set([
        "emailaddress",
        "email",
        "email_address",
        "opened",
        "clicked",
        "replied",
        "bounced",
        "unsubscribed",
      ]);

      const rawHeaders = parseCsvRow(lines[0]).map((h) =>
        h.trim().toLowerCase().replace(/\s+/g, "_"),
      );
      const rows = lines.slice(1);

      // Validate that CSV has an email column
      const hasEmailColumn = rawHeaders.some(
        (h) => h === "emailaddress" || h === "email" || h === "email_address",
      );
      if (!hasEmailColumn) {
        return sendError(
          reply,
          400,
          "MISSING_EMAIL",
          "CSV must have an EmailAddress or Email column",
        );
      }

      function isEngaged(val) {
        const v = val?.trim().toLowerCase();
        return v === "x" || v === "1" || v === "true";
      }

      const now = nowIso();
      const campaignId = request.params.id;
      const importRows = rows.map((row) => {
        const cols = parseCsvRow(row);
        const record = Object.create(null);
        rawHeaders.forEach((h, i) => {
          if (GMASS_HEADERS.has(h)) record[h] = cols[i] || null;
        });

        return {
          id: newUuid(),
          email: normalizeEmail(record),
          opened: isEngaged(record.opened) ? 1 : 0,
          clicked: isEngaged(record.clicked) ? 1 : 0,
          replied: isEngaged(record.replied) ? 1 : 0,
          bounced: isEngaged(record.bounced) ? 1 : 0,
          unsubscribed: isEngaged(record.unsubscribed) ? 1 : 0,
        };
      });

      const {
        matched,
        skippedUnknown,
        bouncedCount,
        unsubscribedCount,
      } = await adminMarketingRepository.importCampaignEngagementsTransaction({
        campaignId,
        rows: importRows,
        now,
      });

      await adminService._audit(
        admin.adminId,
        "marketing_results_import",
        "marketing_campaigns",
        campaignId,
        {
          filename,
          matched,
          skipped: skippedUnknown,
          bounced: bouncedCount,
          unsubscribed: unsubscribedCount,
          total_rows: rows.length,
        },
      );

      reply.send({
        success: true,
        matched,
        skipped: skippedUnknown,
        bounced: bouncedCount,
        unsubscribed: unsubscribedCount,
        total: rows.length,
      });
    },
  );

  // --- Campaign Engagements ---
  app.get(
    "/admin/dashboard/marketing/campaigns/:id/engagements",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      if (!(await adminMarketingRepository.campaignExists(request.params.id))) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }

      const { limit, offset } = parsePagination(request.query);
      const { opened, clicked, replied, bounced } = request.query;
      const openedFilter = parseBooleanFilter(opened, "opened", reply);
      if (openedFilter === null) return;
      const clickedFilter = parseBooleanFilter(clicked, "clicked", reply);
      if (clickedFilter === null) return;
      const repliedFilter = parseBooleanFilter(replied, "replied", reply);
      if (repliedFilter === null) return;
      const bouncedFilter = parseBooleanFilter(bounced, "bounced", reply);
      if (bouncedFilter === null) return;

      const { engagements, total } =
        await adminMarketingRepository.listCampaignEngagements({
          campaignId: request.params.id,
          filters: {
            opened: openedFilter,
            clicked: clickedFilter,
            replied: repliedFilter,
            bounced: bouncedFilter,
          },
          limit,
          offset,
        });
      reply.send({ engagements, total, limit, offset });
    },
  );

  // --- Export Contacts CSV ---
  app.get(
    "/admin/dashboard/marketing/contacts/export",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const { status, campaign_id, opened, clicked } = request.query;
      if (status && !MARKETING_CONTACT_STATUSES.includes(status)) {
        return sendError(
          reply,
          400,
          "INVALID_STATUS",
          `Status must be one of: ${MARKETING_CONTACT_STATUSES.join(", ")}`,
        );
      }
      const openedFilter = parseBooleanFilter(opened, "opened", reply);
      if (openedFilter === null) return;
      const clickedFilter = parseBooleanFilter(clicked, "clicked", reply);
      if (clickedFilter === null) return;

      let contacts;

      if (campaign_id) {
        if (!(await adminMarketingRepository.campaignExists(campaign_id))) {
          return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
        }
      }

      contacts = await adminMarketingRepository.exportContacts({
        campaignId: campaign_id,
        status,
        opened: openedFilter,
        clicked: clickedFilter,
      });

      // Build CSV
      const csvLines = ["First Name,Last Name,Email"];
      for (const c of contacts) {
        csvLines.push(
          `${sanitizeCsvCell(c.first_name)},${sanitizeCsvCell(c.last_name)},${sanitizeCsvCell(c.email)}`,
        );
      }

      await adminService._audit(
        admin.adminId,
        "marketing_contacts_export",
        "marketing_contacts",
        null,
        {
          filters: { status, campaign_id, opened, clicked },
          row_count: contacts.length,
        },
      );

      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="contacts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        )
        .header("Cache-Control", "no-store")
        .send(csvLines.join("\n"));
    },
  );

  // ============ TRACK TRANSFER ============

  registerAdminTrackTransferRoutes(app, {
    adminTrackTransferRepo,
    requireAdminRole,
    sendError,
  });

  // Admin SPA catch-all - serves index.html for client-side routing
  // Must come AFTER all /admin/* API routes so they take precedence
  // Using fs.readFile instead of reply.sendFile because decorateReply: false on static registrations
  const adminIndexPath = path.join(process.cwd(), "public/admin/index.html");
  const adminStaticRoot = path.join(process.cwd(), "public/admin");

  app.get("/admin/assets/*", async (request, reply) => {
    if (!(await requireAdminUiAccess(request, reply))) return;
    const assetPath = request.params["*"];
    return sendAdminStaticFile(
      reply,
      path.join(adminStaticRoot, "assets"),
      assetPath,
    );
  });

  app.get("/admin", async (request, reply) => {
    if (!(await requireAdminUiAccess(request, reply))) return;
    const content = await fs.promises.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  app.get("/admin/*", async (request, reply) => {
    if (!(await requireAdminUiAccess(request, reply))) return;
    // Handles client-side routes: /admin/login, /admin/users, /admin/jobs, etc.
    const relativePath = request.params["*"];
    if (relativePath) {
      const resolvedPath = path.resolve(adminStaticRoot, relativePath);
      const relativeToRoot = path.relative(adminStaticRoot, resolvedPath);
      if (
        !relativeToRoot.startsWith("..") &&
        !path.isAbsolute(relativeToRoot) &&
        fs.existsSync(resolvedPath) &&
        fs.statSync(resolvedPath).isFile()
      ) {
        return sendAdminStaticFile(reply, adminStaticRoot, relativePath);
      }
    }
    const content = await fs.promises.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  return { requireAdminRole };
}

module.exports = { registerAdminRoutes };
