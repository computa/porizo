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
const defaultOneSignalService = require("../services/onesignal");
const { registerAdminAnalyticsRoutes } = require("./admin/analytics");
const { registerAdminAuthRoutes } = require("./admin/auth");
const { registerAdminBillingRoutes } = require("./admin/billing");
const { registerAdminBlendAnalysisRoutes } = require("./admin/blend-analysis");
const { registerAdminBlogRoutes } = require("./admin/blog");
const { registerAdminDemoShareRoutes } = require("./admin/demo-shares");
const { registerAdminFeatureFlagRoutes } = require("./admin/feature-flags");
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
const { registerAdminStorySessionRoutes } = require("./admin/story-sessions");
const { registerAdminTrackTransferRoutes } = require("./admin/track-transfer");
const { registerAdminWebhookHealthRoutes } = require("./admin/webhook-health");
const { registerAdminEtsyCodeRoutes } = require("./admin/etsy-codes");
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
  const adminAuthRepo = adminAuthRepository || createAdminAuthRepository(db);
  const adminMusicDiagnosticsRepo =
    adminMusicDiagnosticsRepository ||
    createAdminMusicDiagnosticsRepository(db);
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

  registerAdminAuthRoutes(app, {
    adminAuthRepo,
    adminAuthService,
    emailService,
    requireAdminSession,
    sendError,
  });

  // --- Blog Publishing CMS ---

  registerAdminBlogRoutes(app, {
    appConfig,
    auditService: adminService.adminAuditService,
    blogService,
    parsePagination,
    requireAdminSession,
    sendError,
  });

  // --- User Management ---

  registerAdminUserReadRoutes(app, {
    userReadService: adminService.adminUserReadService,
    parsePagination,
    requireAdminSession,
    sendError,
  });

  registerAdminUserMutationRoutes(app, {
    requireAdminRole,
    requireAdminSession,
    sendError,
    userMutationService: adminService.adminUserMutationService,
  });

  registerAdminBillingRoutes(app, {
    adminBillingRepo,
    auditService: adminService.adminAuditService,
    billingService: adminService.adminBillingService,
    entitlementsService: adminService.adminEntitlementsService,
    planConfigService,
    requireAdminRole,
    requireAdminSession,
    sendError,
    subscriptionManager,
    validateReason,
  });

  // --- User Session Management ---

  registerAdminUserSessionControlRoutes(app, {
    requireAdminRole,
    requireAdminSession,
    sendError,
    userSessionControlService: adminService.adminUserSessionControlService,
  });

  // --- Metrics ---

  registerAdminMetricsRoutes(app, {
    jobOpsService: adminService.adminJobOpsService,
    metricsService: adminService.adminMetricsService,
    requireAdminSession,
  });

  // --- Jobs ---

  registerAdminJobOpsRoutes(app, {
    jobOpsService: adminService.adminJobOpsService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- Moderation ---

  registerAdminModerationRoutes(app, {
    moderationService: adminService.adminModerationService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
    validateReason,
  });

  // --- Story Sessions ---

  registerAdminStorySessionRoutes(app, {
    storySessionService: adminService.adminStorySessionService,
    parsePagination,
    requireAdminSession,
    sendError,
  });

  // --- Share Management ---

  registerAdminShareRoutes(app, {
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
    shareManagementService: adminService.adminShareManagementService,
  });
  registerAdminWebhookHealthRoutes(app, {
    webhookHealthService: adminService.adminWebhookHealthService,
    requireAdminSession,
  });

  // --- Etsy Redemption Codes (Gate A) ---

  registerAdminEtsyCodeRoutes(app, {
    db,
    requireAdminRole,
    auditService: adminService.adminAuditService,
    etsyOrderService: app.etsyOrderService,
    etsyArtifactService: app.etsyArtifactService,
    etsyClient: app.etsyClient,
    sendError,
  });
  registerAdminGrowthRoutes(app, {
    growthService: adminService.adminGrowthService,
    metricsService: adminService.adminMetricsService,
    requireAdminSession,
    sendError,
  });
  registerAdminKpiRoutes(app, {
    db,
    requireAdminSession,
  });
  registerAdminAnalyticsRoutes(app, {
    analyticsService: adminService.adminAnalyticsService,
    requireAdminSession,
  });

  // --- Gift Operations ---

  registerAdminGiftOpsRoutes(app, {
    db,
    adminGiftOpsService,
    auditService: adminService.adminAuditService,
    parsePagination,
    requireAdminRole,
    sendError,
  });

  // --- Security Section ---

  registerAdminSecurityObservabilityRoutes(app, {
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    securityObservabilityService:
      adminService.adminSecurityObservabilityService,
    systemHealthService: adminService.adminSystemHealthService,
  });

  registerAdminSecurityConfigRoutes(app, {
    requireAdminRole,
    requireAdminSession,
    securityConfigService: adminService.adminSecurityConfigService,
    sendError,
  });

  // --- Provider Control Plane ---

  registerAdminProviderQueueControlRoutes(app, {
    controlPlaneService: adminService.adminControlPlaneService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  // --- STT Provider Config ---

  registerAdminProviderConfigRoutes(app, {
    appConfig,
    providerConfigService: adminService.adminProviderConfigService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerAdminMusicDiagnosticsRoutes(app, {
    musicDiagnosticsService: adminService.adminMusicDiagnosticsService,
    requireAdminSession,
    sendError,
  });

  // --- Feature Flags Config ---

  registerAdminFeatureFlagRoutes(app, {
    featureFlagService: adminService.adminFeatureFlagService,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerClientConfigRoutes(app, {
    clientConfigService: publicClientConfigService,
  });

  registerAdminOnboardingSampleRoutes(app, {
    onboardingSampleService: adminService.adminOnboardingSampleService,
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
    appConfig,
    auditService: adminService.adminAuditService,
    newUuid,
    nowIso,
    requireAdminRole,
    requireAdminSession,
    sendError,
  });

  registerAdminMarketingRoutes(app, {
    adminMarketingRepository,
    auditService: adminService.adminAuditService,
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
