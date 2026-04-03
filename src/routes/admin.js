"use strict";

const fs = require("fs");
const path = require("path");
const { AdminService, escapeLikePattern } = require("../services/admin-service");
const { analyzeBlend, formatAnalysisReport } = require("../utils/blend-analyzer");
const { newUuid } = require("../utils/ids");
const { nowIso } = require("../utils/common");

function registerAdminRoutes(app, {
  db,
  appConfig,
  sendError,
  adminAuthService,
  subscriptionManager,
  planConfigService,
}) {
// ============ ADMIN DASHBOARD API ============

const adminService = new AdminService(db);
adminAuthService.initialize(db);

/**
 * Admin session auth helper - validates Bearer token from Authorization header
 * Returns admin info if valid, null if invalid (and sends error response)
 */
async function requireAdminSession(request, reply) {
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
    sendError(reply, 403, "FORBIDDEN", `This action requires one of: ${allowedRoles.join(', ')}`);
    return null;
  }

  return admin;
}

/**
 * Parse pagination params from query with defaults
 */
function parsePagination(query, defaultLimit = 50) {
  return {
    limit: Math.max(1, Math.min(100, parseInt(query.limit, 10) || defaultLimit)),
    offset: Math.max(0, parseInt(query.offset, 10) || 0),
  };
}

function validateReason(reason, reply) {
  if (!reason || reason.trim().length < 10) {
    sendError(reply, 400, "MISSING_REASON", "Reason must be at least 10 characters");
    return null;
  }
  if (reason.trim().length > 500) {
    sendError(reply, 400, "INVALID_REASON", "Reason must not exceed 500 characters");
    return null;
  }
  return reason.trim();
}

function isValidVersionString(value) {
  return /^\d+(?:\.\d+){0,3}$/.test(value);
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
    return sendError(reply, 400, "BAD_REQUEST", "Email and password required");
  }

  const result = await adminAuthService.createAdmin(email, password, displayName || "Admin", "superadmin");
  if (!result.success) {
    return sendError(reply, 400, "BAD_REQUEST", result.error);
  }

  reply.send({ success: true, id: result.id, message: "Admin created. Remove ADMIN_SETUP_SECRET to disable this endpoint." });
});

app.post("/admin/auth/login", async (request, reply) => {
  const { email, password } = request.body || {};
  if (!email || !password) {
    return sendError(reply, 400, "BAD_REQUEST", "Email and password required");
  }

  const ip = request.ip;
  const userAgent = request.headers["user-agent"];
  const result = await adminAuthService.login(email, password, ip, userAgent);

  if (!result.success) {
    return sendError(reply, 401, "UNAUTHORIZED", result.error);
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
    return reply.code(400).send({ error: "MISSING_FIELDS", message: "Current and new password required" });
  }
  if (newPassword.length < 8) {
    return reply.code(400).send({ error: "WEAK_PASSWORD", message: "Password must be at least 8 characters" });
  }

  // Verify current password first
  const loginResult = await adminAuthService.login(admin.email, currentPassword);
  if (!loginResult.success) {
    return reply.code(401).send({ error: "INVALID_PASSWORD", message: "Current password is incorrect" });
  }

  // Change password (this also invalidates all sessions)
  await adminAuthService.changePassword(admin.adminId, newPassword);
  reply.send({ success: true, message: "Password changed. Please log in again." });
});

// --- User Management ---

app.get("/admin/dashboard/users", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { email, userId, riskLevel, tier, trackId, shareId, recipientName } = request.query;
  const users = await adminService.searchUsers({
    email, userId, riskLevel, tier, trackId, shareId, recipientName,
    ...parsePagination(request.query),
  });
  reply.send({ users });
});

app.get("/admin/dashboard/users/stats", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const stats = await adminService.getUserStats();
  reply.send(stats);
});

app.get("/admin/dashboard/users/:id", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const detail = await adminService.getUserDetail(request.params.id);
  if (!detail) {
    sendError(reply, 404, "NOT_FOUND", "User not found");
    return;
  }
  reply.send(detail);
});

app.put("/admin/dashboard/users/:id/risk", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { riskLevel, reason } = request.body || {};
  if (!riskLevel || !["low", "medium", "high"].includes(riskLevel)) {
    sendError(reply, 400, "INVALID_PARAMS", "riskLevel must be low, medium, or high");
    return;
  }
  const result = await adminService.updateUserRisk(request.params.id, riskLevel, admin.adminId, reason || "");
  reply.send(result);
});

app.post("/admin/dashboard/users/:id/lock", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { locked, reason } = request.body || {};
  const result = await adminService.lockUser(request.params.id, Boolean(locked), admin.adminId, reason || "");
  reply.send(result);
});

app.delete("/admin/dashboard/users/:id", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { reason } = request.body || {};
  const result = await adminService.deleteUser(request.params.id, admin.adminId, reason || 'Admin deletion');
  if (!result.success) {
    sendError(reply, 404, "USER_NOT_FOUND", result.error);
    return;
  }
  reply.send(result);
});

app.post("/admin/dashboard/users/bulk-action", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { action, userIds, reason } = request.body || {};
  if (!action || !Array.isArray(userIds) || userIds.length === 0) {
    sendError(reply, 400, "INVALID_PARAMS", "action and userIds[] are required");
    return;
  }
  const result = await adminService.bulkUserAction(userIds, action, admin.adminId, reason || '');
  reply.send(result);
});

app.put("/admin/dashboard/users/:id/profile", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const fields = request.body || {};
  const result = await adminService.updateUserProfile(request.params.id, fields, admin.adminId);
  if (!result.success) {
    sendError(reply, 400, "INVALID_PARAMS", result.error);
    return;
  }
  reply.send(result);
});

app.put("/admin/dashboard/users/:id/entitlements", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const fields = request.body || {};
  const result = await adminService.updateUserEntitlements(request.params.id, fields, admin.adminId);
  if (!result.success) {
    sendError(reply, 400, "INVALID_PARAMS", result.error);
    return;
  }
  reply.send(result);
});

// --- Admin Complimentary Upgrades ---

app.post("/admin/dashboard/users/:id/complimentary-upgrade", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { tier, duration_days, reason } = request.body || {};

  if (!tier || !['plus', 'pro'].includes(tier)) {
    return sendError(reply, 400, "INVALID_TIER", "Tier must be 'plus' or 'pro'");
  }
  if (!Number.isInteger(duration_days) || duration_days < 1 || duration_days > 365) {
    return sendError(reply, 400, "INVALID_DURATION", "Duration must be 1-365 days (integer)");
  }
  const trimmedReason = validateReason(reason, reply);
  if (!trimmedReason) return;

  try {
    const result = await subscriptionManager.adminComplimentaryUpgrade(
      request.params.id, tier, duration_days, trimmedReason, admin.adminId
    );
    reply.send(result);
  } catch (err) {
    console.error("[Admin] Complimentary upgrade error:", err);
    sendError(reply, 500, "UPGRADE_ERROR", "Internal error processing upgrade");
  }
});

app.delete("/admin/dashboard/users/:id/complimentary-upgrade", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { reason } = request.body || {};
  const trimmedReason = validateReason(reason, reply);
  if (!trimmedReason) return;

  try {
    const result = await subscriptionManager.revokeComplimentaryUpgrade(
      request.params.id, trimmedReason, admin.adminId
    );
    reply.send(result);
  } catch (err) {
    console.error("[Admin] Revoke upgrade error:", err);
    sendError(reply, 500, "REVOKE_ERROR", "Internal error processing revocation");
  }
});

// --- User Session Management ---

app.get("/admin/dashboard/users/:userId/sessions", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { userId } = request.params;
  const sessions = await adminService.getUserSessions(userId);
  reply.send({ sessions });
});

app.post("/admin/dashboard/users/:userId/sessions/:sessionId/revoke", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { userId, sessionId } = request.params;
  const { reason } = request.body || {};
  const result = await adminService.revokeUserSession(userId, sessionId, admin.adminId, reason || 'Admin revocation');
  if (!result.success) {
    sendError(reply, 404, "SESSION_NOT_FOUND", result.error);
    return;
  }
  reply.send(result);
});

app.post("/admin/dashboard/users/:userId/sessions/revoke-all", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { userId } = request.params;
  const { reason } = request.body || {};
  const result = await adminService.revokeAllUserSessions(userId, admin.adminId, reason || 'Admin revocation');
  reply.send(result);
});

// --- Voice Profile Management ---

app.post("/admin/dashboard/users/:userId/voice/force-reverify", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { userId } = request.params;
  const { reason } = request.body || {};
  const result = await adminService.forceVoiceReverify(userId, admin.adminId, reason || 'Admin-initiated re-verification');
  if (!result.success) {
    sendError(reply, 404, "VOICE_PROFILE_NOT_FOUND", result.error);
    return;
  }
  reply.send(result);
});

// --- Metrics ---

app.get("/admin/dashboard/metrics/overview", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send(await adminService.getOverviewMetrics());
});

app.get("/admin/dashboard/metrics/jobs", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send(await adminService.getJobMetrics());
});

app.get("/admin/dashboard/metrics/costs", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { days } = request.query;
  reply.send(await adminService.getCostMetrics(days ? parseInt(days) : 30));
});

app.get("/admin/dashboard/metrics/enrollment", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send(await adminService.getEnrollmentMetrics());
});

app.get("/admin/dashboard/metrics/render-pipeline", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send(await adminService.getRenderSuccessMetrics());
});

app.get("/admin/dashboard/security/risk-metrics", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send(await adminService.getRiskMetrics());
});

// --- Jobs ---

app.get("/admin/dashboard/jobs", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { status, workflowType } = request.query;
  reply.send({
    jobs: await adminService.listJobs({ status, workflowType, ...parsePagination(request.query) }),
  });
});

app.post("/admin/dashboard/jobs/:id/retry", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;
  const result = await adminService.retryJob(request.params.id, admin.adminId);
  if (!result.success) {
    sendError(reply, 400, "RETRY_ERROR", result.error);
    return;
  }
  reply.send(result);
});

// --- Dead Letter Queue ---

app.get("/admin/dashboard/dlq", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send({ entries: await adminService.listDLQ(parsePagination(request.query)) });
});

app.post("/admin/dashboard/dlq/:id/reprocess", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;
  const { reason } = request.body || {};
  const result = await adminService.reprocessDLQ(request.params.id, admin.adminId, reason || "Admin reprocess");
  if (!result.success) {
    sendError(reply, 400, "DLQ_REPROCESS_ERROR", result.error);
    return;
  }
  reply.send(result);
});

// --- Moderation ---

app.get("/admin/dashboard/moderation/queue", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  reply.send({ items: await adminService.getModerationQueue(parsePagination(request.query)) });
});

app.post("/admin/dashboard/moderation/:versionId/override", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;
  const { reason } = request.body || {};
  if (!reason) {
    sendError(reply, 400, "INVALID_PARAMS", "reason is required");
    return;
  }
  const result = await adminService.overrideModeration(request.params.versionId, admin.adminId, reason);
  reply.send(result);
});

// --- Story Sessions ---

app.get("/admin/dashboard/story/sessions", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { status, engineVersion } = request.query;
  const sessions = await adminService.listStorySessions({
    status,
    engineVersion,
    ...parsePagination(request.query),
  });
  reply.send({ sessions });
});

app.get("/admin/dashboard/story/sessions/:id", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const detail = await adminService.getStorySessionDetail(request.params.id);
  if (!detail) {
    sendError(reply, 404, "NOT_FOUND", "Story session not found");
    return;
  }
  reply.send(detail);
});

// --- Share Management ---

app.get("/admin/dashboard/shares", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { status, trackId, userId } = request.query;
  const shares = await adminService.listShares({
    status,
    trackId,
    userId,
    ...parsePagination(request.query),
  });
  reply.send({ shares });
});

app.post("/admin/dashboard/share/:id/rebind", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;
  const { newDeviceId, reason } = request.body || {};
  if (!newDeviceId) {
    sendError(reply, 400, "INVALID_PARAMS", "newDeviceId is required");
    return;
  }
  const result = await adminService.rebindShare(request.params.id, newDeviceId, admin.adminId, reason || "");
  if (!result.success) {
    sendError(reply, 400, "REBIND_ERROR", result.error);
    return;
  }
  reply.send(result);
});

// --- Poem Share Management ---

app.get("/admin/dashboard/poem-shares", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { status, poemId, userId } = request.query;
  const shares = await adminService.listPoemShares({
    status,
    poemId,
    userId,
    ...parsePagination(request.query),
  });
  reply.send({ shares });
});

app.post("/admin/dashboard/poem-share/:id/reset-attempts", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;
  const { reason } = request.body || {};
  const result = await adminService.resetPoemShareAttempts(request.params.id, admin.adminId, reason || "");
  if (!result.success) {
    sendError(reply, 400, "RESET_ERROR", result.error);
    return;
  }
  reply.send(result);
});

app.post("/admin/dashboard/poem-share/:id/revoke", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["admin", "superadmin"]);
  if (!admin) return;
  const { reason } = request.body || {};
  const result = await adminService.revokePoemShare(request.params.id, admin.adminId, reason || "");
  if (!result.success) {
    sendError(reply, 400, "REVOKE_ERROR", result.error);
    return;
  }
  reply.send(result);
});

// --- Security Section ---

app.get("/admin/dashboard/security/health", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const health = await adminService.getSystemHealth();
  reply.send(health);
});

app.get("/admin/dashboard/security/auth-events", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { eventType, userId, startDate, endDate } = request.query;
  const events = await adminService.searchAuthEvents({
    eventType, userId, startDate, endDate,
    ...parsePagination(request.query),
  });
  reply.send({ events });
});

app.get("/admin/dashboard/security/auth-events/stats", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const stats = await adminService.getAuthEventStats();
  reply.send(stats);
});

app.get("/admin/dashboard/security/apple-refresh", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { days } = request.query;
  const stats = await adminService.getAppleRefreshTokenStats(Number(days) || 7);
  reply.send(stats);
});

app.get("/admin/dashboard/security/audit-logs", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { action, resourceType, startDate, endDate } = request.query;
  const logs = await adminService.searchAuditLogs({
    action, resourceType, startDate, endDate,
    ...parsePagination(request.query),
  });
  reply.send({ logs });
});

app.get("/admin/dashboard/security/rate-limits", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { userId, actionType, nearLimit } = request.query;
  const limits = await adminService.getRateLimits({
    userId, actionType,
    nearLimit: nearLimit === 'true',
    ...parsePagination(request.query),
  });
  reply.send({ limits });
});

app.post("/admin/dashboard/security/rate-limits/:userId/:actionType/reset", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { userId, actionType } = request.params;
  const { reason } = request.body || {};
  const result = await adminService.resetUserRateLimit(userId, actionType, admin.adminId, reason || 'Admin reset');
  reply.send(result);
});

app.get("/admin/dashboard/security/consent-logs", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { consentVersion, startDate, endDate } = request.query;
  const consents = await adminService.getConsentLogs({
    consentVersion, startDate, endDate,
    ...parsePagination(request.query),
  });
  reply.send({ consents });
});

app.get("/admin/dashboard/security/config", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const config = await adminService.getSecurityConfig();
  reply.send(config);
});

app.put("/admin/dashboard/security/config", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const config = request.body;

  // Validate required fields and bounds
  const sessionHours = parseInt(config.sessionDurationHours);
  const maxAttempts = parseInt(config.maxFailedLoginAttempts);
  const lockoutMins = parseInt(config.lockoutDurationMinutes);

  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 720) {
    sendError(reply, 400, "INVALID_CONFIG", "sessionDurationHours must be between 1 and 720");
    return;
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    sendError(reply, 400, "INVALID_CONFIG", "maxFailedLoginAttempts must be between 1 and 20");
    return;
  }
  if (!Number.isInteger(lockoutMins) || lockoutMins < 1 || lockoutMins > 1440) {
    sendError(reply, 400, "INVALID_CONFIG", "lockoutDurationMinutes must be between 1 and 1440");
    return;
  }
  if (config.rateLimitDefaults && typeof config.rateLimitDefaults !== 'object') {
    sendError(reply, 400, "INVALID_CONFIG", "rateLimitDefaults must be an object");
    return;
  }
  if (config.iosMinSupportedVersion && !isValidVersionString(String(config.iosMinSupportedVersion).trim())) {
    sendError(reply, 400, "INVALID_CONFIG", "iosMinSupportedVersion must look like 1.2.3");
    return;
  }
  if (config.iosRecommendedVersion && !isValidVersionString(String(config.iosRecommendedVersion).trim())) {
    sendError(reply, 400, "INVALID_CONFIG", "iosRecommendedVersion must look like 1.2.3");
    return;
  }
  if (config.iosUpdateMessage && String(config.iosUpdateMessage).length > 280) {
    sendError(reply, 400, "INVALID_CONFIG", "iosUpdateMessage must be 280 characters or fewer");
    return;
  }
  if (config.iosAutoRecommendedVersion != null && typeof config.iosAutoRecommendedVersion !== "boolean") {
    sendError(reply, 400, "INVALID_CONFIG", "iosAutoRecommendedVersion must be true or false");
    return;
  }

  // Sanitize to only allowed fields
  const sanitizedConfig = {
    sessionDurationHours: sessionHours,
    maxFailedLoginAttempts: maxAttempts,
    lockoutDurationMinutes: lockoutMins,
    rateLimitDefaults: config.rateLimitDefaults || {},
    iosMinSupportedVersion: String(config.iosMinSupportedVersion || "").trim(),
    iosRecommendedVersion: String(config.iosRecommendedVersion || "").trim(),
    iosUpdateMessage: String(config.iosUpdateMessage || "").trim(),
    iosAutoRecommendedVersion: Boolean(config.iosAutoRecommendedVersion),
    iosLastAppStoreVersion: String(config.iosLastAppStoreVersion || "").trim(),
    iosLastAppStoreSyncAt: String(config.iosLastAppStoreSyncAt || "").trim(),
    iosAppStoreSyncError: String(config.iosAppStoreSyncError || "").trim(),
  };

  const result = await adminService.updateSecurityConfig(sanitizedConfig, admin.adminId);
  reply.send(result);
});

app.post("/admin/dashboard/security/config/sync-ios-version", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  try {
    const result = await adminService.syncIOSVersionFromAppStore(admin.adminId, { force: true });
    reply.send(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "App Store Connect sync failed";
    sendError(reply, 502, "APP_STORE_SYNC_FAILED", message);
  }
});

// --- Provider Control Plane ---

app.get("/admin/dashboard/providers", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const providers = await adminService.getProviderStatus();
  reply.send({ providers });
});

app.post("/admin/dashboard/providers/:providerName/status", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { providerName } = request.params;
  const { status, reason } = request.body || {};

  if (!['active', 'paused', 'disabled'].includes(status)) {
    sendError(reply, 400, "INVALID_STATUS", "Status must be active, paused, or disabled");
    return;
  }

  const result = await adminService.setProviderStatus(providerName, status, admin.adminId, reason);
  reply.send(result);
});

// --- Queue Control Plane ---

app.get("/admin/dashboard/queues", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const queues = await adminService.getQueueStatus();
  reply.send({ queues });
});

app.post("/admin/dashboard/queues/:queueName/status", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { queueName } = request.params;
  const { status, reason } = request.body || {};

  if (!['active', 'paused', 'draining'].includes(status)) {
    sendError(reply, 400, "INVALID_STATUS", "Status must be active, paused, or draining");
    return;
  }

  const result = await adminService.setQueueStatus(queueName, status, admin.adminId, reason);
  reply.send(result);
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

app.get("/admin/dashboard/billing/transactions", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { limit, offset } = request.query;
  const transactions = await adminService.getBillingTransactions({ limit, offset });
  reply.send({ transactions });
});

app.get("/admin/dashboard/webhooks/health", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const health = await adminService.getWebhookHealth();
  reply.send(health);
});

// --- Growth & Attribution ---

app.get("/admin/dashboard/growth/attribution", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const days = parseInt(request.query.days) || 30;
  const attribution = await adminService.getAttribution(days);
  reply.send(attribution);
});

app.get("/admin/dashboard/growth/teasers", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const days = parseInt(request.query.days) || 7;
  const metrics = await adminService.getTeaserMetrics(days);
  reply.send(metrics);
});

app.get("/admin/dashboard/growth/shares", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const days = parseInt(request.query.days) || 30;
  const metrics = await adminService.getShareMetrics(days);
  reply.send(metrics);
});

// --- KPI Dashboard ---

app.get("/admin/dashboard/kpis", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const days = parseInt(request.query.days) || 30;
  const { getKPIAggregates } = require("../jobs/compute-daily-aggregates");
  const aggregates = await getKPIAggregates(db, days);
  reply.send({ aggregates });
});

app.get("/admin/dashboard/kpis/trends", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const { getKPITrends, ensureRecentAggregates } = require("../jobs/compute-daily-aggregates");
  // Ensure we have recent data first
  await ensureRecentAggregates(db, 14);
  const trends = await getKPITrends(db);
  reply.send(trends);
});

// --- STT Provider Config ---

app.get("/admin/dashboard/stt/config", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const config = await adminService.getSTTConfig();
  reply.send(config);
});

app.put("/admin/dashboard/stt/config", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const { primary_provider, fallback_provider, whisperkit_model } = request.body || {};

  try {
    const result = await adminService.setSTTConfig(
      { primary_provider, fallback_provider, whisperkit_model },
      admin.adminId
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
      available_generation_modes: ["composition_plan", "compose_detailed"],
    });
  } catch (err) {
    sendError(reply, 500, "MUSIC_CONFIG_ERROR", "Failed to load music provider config.");
  }
});

app.put("/admin/dashboard/music/config", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const {
    default_provider,
    auto_style_routing,
    elevenlabs_generation_mode,
    auto_reroll_enabled,
    quality_threshold,
    max_rerolls,
    style_overrides,
  } = request.body || {};

  if (!request.body || typeof request.body !== "object" || Object.keys(request.body).length === 0) {
    return sendError(reply, 400, "INVALID_CONFIG", "Request body must contain at least one config key.");
  }

  if (default_provider !== undefined) {
    if (!["elevenlabs", "suno"].includes(default_provider)) {
      return sendError(reply, 400, "INVALID_CONFIG", "default_provider must be one of: elevenlabs, suno");
    }
    const providerHasKey =
      default_provider === "elevenlabs"
        ? Boolean(appConfig.ELEVENLABS_API_KEY)
        : Boolean(appConfig.SUNO_API_KEY);
    if (!providerHasKey) {
      return sendError(
        reply,
        400,
        "INVALID_CONFIG",
        `Cannot set default_provider=${default_provider}: missing API key in environment.`
      );
    }
  }

  try {
    const result = await adminService.setMusicProviderConfig(
      {
        ...(default_provider !== undefined ? { default_provider } : {}),
        ...(auto_style_routing !== undefined ? { auto_style_routing } : {}),
        ...(elevenlabs_generation_mode !== undefined ? { elevenlabs_generation_mode } : {}),
        ...(auto_reroll_enabled !== undefined ? { auto_reroll_enabled } : {}),
        ...(quality_threshold !== undefined ? { quality_threshold } : {}),
        ...(max_rerolls !== undefined ? { max_rerolls } : {}),
        ...(style_overrides !== undefined ? { style_overrides } : {}),
      },
      admin.adminId
    );
    reply.send(result);
  } catch (err) {
    sendError(reply, 400, "INVALID_CONFIG", err.message);
  }
});

app.get("/admin/dashboard/music/diagnostics", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const limit = parseInt(request.query.limit, 10) || 30;
  const provider = typeof request.query.provider === "string" ? request.query.provider : null;
  const status = typeof request.query.status === "string" ? request.query.status : null;

  try {
    const diagnostics = await adminService.getRecentMusicDiagnostics({
      limit,
      provider,
      status,
    });
    reply.send(diagnostics);
  } catch (err) {
    sendError(reply, 500, "MUSIC_DIAGNOSTICS_ERROR", "Failed to load music diagnostics.");
  }
});

// --- Feature Flags Config ---

app.get("/admin/dashboard/feature-flags", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  try {
    const flags = await adminService.getAllFeatureFlags();
    reply.send(flags);
  } catch (err) {
    console.error('[Admin] FF_GET_ERROR: Failed to get feature flags:', err.message);
    sendError(reply, 500, "FEATURE_FLAGS_ERROR", "Failed to load feature flags. Please try again.");
  }
});

app.put("/admin/dashboard/feature-flags", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;
  const updates = request.body || {};

  if (typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return sendError(reply, 400, "INVALID_REQUEST", "Request body must be an object with flag updates");
  }

  try {
    const result = await adminService.updateFeatureFlags(updates, admin.adminId);
    reply.send(result);
  } catch (err) {
    console.error('[Admin] FF_UPDATE_ERROR: Failed to update feature flags:', err.message);
    sendError(reply, 500, "FEATURE_FLAGS_ERROR", "Failed to save feature flags. Please try again.");
  }
});

// --- Public App Config (for mobile clients) ---

app.get("/app/config", async (request, reply) => {
  // Public endpoint - no auth required
  // Returns safe-for-client configuration
  const config = await adminService.getAppConfig();
  reply.send(config);
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
    sendError(reply, 500, "PLANS_ERROR", "Failed to load subscription plans.");
  }
});

app.put("/admin/billing/plans/:id", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ["superadmin"]);
  if (!admin) return;

  const { id } = request.params;
  const body = request.body || {};

  // Allowlist and type-validate fields
  const updates = {};
  const intFields = ["songs_per_month", "poems_per_month", "previews_per_day", "price_monthly_cents", "price_annual_cents", "sort_order"];
  for (const field of intFields) {
    if (body[field] !== undefined) {
      const val = parseInt(body[field], 10);
      if (!Number.isInteger(val) || val < 0) {
        sendError(reply, 400, "INVALID_FIELD", `${field} must be a non-negative integer.`);
        return;
      }
      updates[field] = val;
    }
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length === 0 || name.length > 200) {
      sendError(reply, 400, "INVALID_FIELD", "name must be 1-200 characters.");
      return;
    }
    updates.name = name;
  }
  if (body.description !== undefined) {
    const desc = String(body.description).trim();
    if (desc.length > 500) {
      sendError(reply, 400, "INVALID_FIELD", "description must be at most 500 characters.");
      return;
    }
    updates.description = desc;
  }
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
  if (body.features_json !== undefined) {
    if (!Array.isArray(body.features_json)) {
      sendError(reply, 400, "INVALID_FIELD", "features_json must be an array.");
      return;
    }
    if (!body.features_json.every(f => typeof f === "string")) {
      sendError(reply, 400, "INVALID_FIELD", "features_json elements must be strings.");
      return;
    }
    if (body.features_json.length > 20) {
      sendError(reply, 400, "INVALID_FIELD", "features_json must have at most 20 items.");
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

    await adminService._audit(admin.adminId, "admin_update_plan", "subscription_plan", id, {
      updates,
    });

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
    const bundles = await db.prepare(
      "SELECT * FROM gift_bundles ORDER BY sort_order ASC"
    ).all();
    reply.send({ bundles });
  } catch (err) {
    console.error("[Admin] Get gift bundles error:", err);
    sendError(reply, 500, "GIFT_BUNDLES_ERROR", err.message);
  }
});

app.put("/admin/billing/gift-bundles/:id", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { id } = request.params;
  const updates = request.body || {};

  const allowedFields = ['token_count', 'display_name', 'description', 'is_active', 'sort_order'];
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
      sendError(reply, 400, "INVALID_TOKEN_COUNT", "token_count must be an integer between 1 and 10.");
      return;
    }
    filteredUpdates.token_count = tc;
  }

  // Validate sort_order
  if (filteredUpdates.sort_order !== undefined) {
    const so = parseInt(filteredUpdates.sort_order, 10);
    if (!Number.isInteger(so) || so < 0) {
      sendError(reply, 400, "INVALID_SORT_ORDER", "sort_order must be a non-negative integer.");
      return;
    }
    filteredUpdates.sort_order = so;
  }

  try {
    // Fetch previous values for audit
    const previous = await db.prepare("SELECT * FROM gift_bundles WHERE id = ?").get(id);
    if (!previous) {
      sendError(reply, 404, "BUNDLE_NOT_FOUND", "Gift bundle not found.");
      return;
    }

    const ALLOWED_COLUMNS = ['token_count', 'display_name', 'description', 'is_active', 'sort_order'];
    const setClauses = [];
    const params = [];
    for (const [key, value] of Object.entries(filteredUpdates)) {
      if (!ALLOWED_COLUMNS.includes(key)) throw new Error(`Unsafe column name: ${key}`);
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
    setClauses.push("updated_at = ?");
    params.push(new Date().toISOString());
    setClauses.push("updated_by = ?");
    params.push(admin.adminId);
    params.push(id);

    await db.prepare(`UPDATE gift_bundles SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    // Audit with previous + new values
    await adminService._audit(admin.adminId, 'admin_update_gift_bundle', 'gift_bundle', id, {
      previous: { token_count: previous.token_count, display_name: previous.display_name, is_active: previous.is_active, sort_order: previous.sort_order },
      updated: filteredUpdates,
    });

    const updated = await db.prepare("SELECT * FROM gift_bundles WHERE id = ?").get(id);
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
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { label, audio_url } = request.body || {};

  try {
    const sample = await adminService.createOnboardingSample({ label, audio_url }, admin.adminId);
    reply.send({ success: true, sample });
  } catch (err) {
    if (err.message.includes('is required') || err.message.includes('must start with') || err.message.includes('must be')) {
      sendError(reply, 400, "VALIDATION_ERROR", err.message);
      return;
    }
    request.log.error({ err }, "[Admin] Create onboarding sample error");
    sendError(reply, 500, "CREATE_ERROR", "An internal error occurred.");
  }
});

app.put("/admin/dashboard/onboarding-samples/:id", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { id } = request.params;
  const updates = request.body || {};

  try {
    const sample = await adminService.updateOnboardingSample(id, updates, admin.adminId);
    reply.send({ success: true, sample });
  } catch (err) {
    if (err.message === 'Onboarding sample not found') {
      sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
      return;
    }
    if (err.message.includes('No valid fields') || err.message.includes('must start with') || err.message.includes('must be')) {
      sendError(reply, 400, "VALIDATION_ERROR", err.message);
      return;
    }
    request.log.error({ err }, "[Admin] Update onboarding sample error");
    sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
  }
});

app.put("/admin/dashboard/onboarding-samples/:id/activate", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { id } = request.params;

  try {
    const sample = await adminService.activateOnboardingSample(id, admin.adminId);
    reply.send({ success: true, sample });
  } catch (err) {
    if (err.message === 'Onboarding sample not found') {
      sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
      return;
    }
    request.log.error({ err }, "[Admin] Activate onboarding sample error");
    sendError(reply, 500, "ACTIVATE_ERROR", "An internal error occurred.");
  }
});

app.delete("/admin/dashboard/onboarding-samples/:id", async (request, reply) => {
  const admin = await requireAdminRole(request, reply, ['superadmin']);
  if (!admin) return;

  const { id } = request.params;

  try {
    const result = await adminService.deleteOnboardingSample(id, admin.adminId);
    reply.send(result);
  } catch (err) {
    if (err.message === 'Onboarding sample not found') {
      sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
      return;
    }
    request.log.error({ err }, "[Admin] Delete onboarding sample error");
    sendError(reply, 500, "DELETE_ERROR", "An internal error occurred.");
  }
});

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
    return sendError(reply, 400, "INVALID_REQUEST", "trackVersionId is required");
  }

  try {
    // Get track version details to find file paths
    const trackVersion = await db.prepare(`
      SELECT tv.*, t.user_id, t.id as track_id
      FROM track_versions tv
      JOIN tracks t ON tv.track_id = t.id
      WHERE tv.id = ?
    `).get(trackVersionId);

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
      `v${version}`
    );

    const filePaths = {
      userEnrollmentPath: null, // Will try to find from voice profile
      originalVocalPath: path.join(basePath, "stems/vocals.wav"),
      convertedVocalPath: path.join(basePath, "user_vocal.wav"),
      blendedOutputPath: path.join(basePath, "blended_vocal.wav"),
    };

    // Try to find user's enrollment audio
    const voiceProfile = await db.prepare(`
      SELECT * FROM voice_profiles
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get(userId);

    if (voiceProfile) {
      // Try to find enrollment audio in S3 or local storage
      const enrollmentBasePath = path.join(
        process.cwd(),
        "storage/enrollment/raw",
        userId
      );
      if (fs.existsSync(enrollmentBasePath)) {
        const sessions = fs.readdirSync(enrollmentBasePath);
        if (sessions.length > 0) {
          const sessionPath = path.join(enrollmentBasePath, sessions[0]);
          const chunks = fs.readdirSync(sessionPath).filter(f => f.endsWith('.wav'));
          if (chunks.length > 0) {
            // Prefer sung chunks for voice comparison
            const sungChunk = chunks.find(c => c.includes('sung')) || chunks[0];
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
      return sendError(reply, 404, "NO_FILES_FOUND", "No audio files found for analysis. Files may have been cleaned up or render incomplete.");
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
      filesMissing: Object.keys(filePaths).filter(k => !existingFiles[k]),
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
    includeReport 
  } = request.body || {};

  // Validate all paths are within STORAGE_DIR (prevent arbitrary file read)
  const storageRoot = path.resolve(appConfig.STORAGE_DIR) + path.sep;
  const paths = { userEnrollmentPath, originalVocalPath, convertedVocalPath, blendedOutputPath };
  const existingPaths = {};
  for (const [key, filePath] of Object.entries(paths)) {
    if (!filePath) continue;
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(storageRoot)) {
      return sendError(reply, 400, "INVALID_PATH", `Path "${key}" must be within storage directory`);
    }
    if (fs.existsSync(resolved)) {
      existingPaths[key] = resolved;
    }
  }

  if (Object.keys(existingPaths).length === 0) {
    return sendError(reply, 400, "NO_FILES", "No valid file paths provided or files don't exist");
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

const DEMO_EXPIRES_AT = "2125-01-01T00:00:00.000Z";

function buildDemoShareUrl(shareId, resourceType) {
  const publicBase =
    appConfig.PUBLIC_BASE_URL ||
    appConfig.STREAM_BASE_URL ||
    "https://porizo.co";
  if (resourceType === "poem") {
    return `${publicBase}/poem/${shareId}?web=1`;
  }
  return `${publicBase}/play/${shareId}?web=1`;
}

app.post("/admin/dashboard/demo-shares", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const { resource_type, resource_id } = request.body || {};
  if (!resource_type || !["song", "poem"].includes(resource_type)) {
    return sendError(reply, 400, "INVALID_PARAMS", "resource_type must be 'song' or 'poem'");
  }
  if (!resource_id) {
    return sendError(reply, 400, "INVALID_PARAMS", "resource_id is required");
  }

  if (resource_type === "song") {
    const track = await db.prepare("SELECT * FROM tracks WHERE id = ? AND deleted_at IS NULL").get(resource_id);
    if (!track) {
      return sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found");
    }

    // Check if share token already exists for this track
    const existing = await db.prepare("SELECT * FROM share_tokens WHERE track_id = ?").get(resource_id);

    let shareId;
    if (existing) {
      // Update existing share to demo type
      shareId = existing.id;
      await db.prepare(`
        UPDATE share_tokens
        SET share_type = 'demo', claim_pin = NULL, expires_at = ?, status = 'unbound',
            web_stream_allowed = 1, bound_device_id = NULL, bound_device_platform = NULL,
            bound_app_version = NULL, bound_at = NULL, bound_user_id = NULL
        WHERE id = ?
      `).run(DEMO_EXPIRES_AT, shareId);
    } else {
      // Insert new demo share
      shareId = newUuid();
      const trackVersion = await db.prepare(
        "SELECT id FROM track_versions WHERE track_id = ? ORDER BY version_num DESC LIMIT 1"
      ).get(resource_id);
      if (!trackVersion) {
        return sendError(reply, 400, "NO_VERSION", "Track has no rendered version");
      }
      await db.prepare(`
        INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, claim_pin,
          expires_at, web_stream_allowed, created_at)
        VALUES (?, ?, ?, ?, 'unbound', 'demo', NULL, ?, 1, ?)
      `).run(shareId, resource_id, trackVersion.id, track.user_id, DEMO_EXPIRES_AT, nowIso());
      // Link share token to track
      await db.prepare("UPDATE tracks SET share_token_id = ? WHERE id = ?").run(shareId, resource_id);
    }

    await adminService._audit(admin.adminId, "admin_create_demo_share", "share_token", shareId, {
      resource_type: "song",
      resource_id,
      action: existing ? "converted_existing" : "created_new",
    });

    reply.send({
      success: true,
      share_id: shareId,
      share_url: buildDemoShareUrl(shareId, "song"),
      resource_type: "song",
      resource_id,
    });
  } else {
    // Poem demo share
    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(resource_id);
    if (!poem) {
      return sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found");
    }

    const existing = await db.prepare("SELECT * FROM poem_share_tokens WHERE poem_id = ?").get(resource_id);

    let shareId;
    if (existing) {
      shareId = existing.id;
      await db.prepare(`
        UPDATE poem_share_tokens
        SET share_type = 'demo', claim_pin = NULL, expires_at = ?, status = 'active',
            bound_user_id = NULL, claim_attempts = 0
        WHERE id = ?
      `).run(DEMO_EXPIRES_AT, shareId);
    } else {
      shareId = newUuid();
      await db.prepare(`
        INSERT INTO poem_share_tokens (id, poem_id, creator_id, status, share_type, claim_pin,
          expires_at, allow_save, created_at)
        VALUES (?, ?, ?, 'active', 'demo', NULL, ?, 1, ?)
      `).run(shareId, resource_id, poem.user_id, DEMO_EXPIRES_AT, nowIso());
    }

    await adminService._audit(admin.adminId, "admin_create_demo_share", "poem_share_token", shareId, {
      resource_type: "poem",
      resource_id,
      action: existing ? "converted_existing" : "created_new",
    });

    reply.send({
      success: true,
      share_id: shareId,
      share_url: buildDemoShareUrl(shareId, "poem"),
      resource_type: "poem",
      resource_id,
    });
  }
});

app.get("/admin/dashboard/demo-shares", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const songShares = await db.prepare(`
    SELECT st.id, st.track_id as resource_id, 'song' as resource_type,
      t.title, st.access_count, st.created_at, st.status
    FROM share_tokens st
    LEFT JOIN tracks t ON t.id = st.track_id
    WHERE st.share_type = 'demo'
    ORDER BY st.created_at DESC
  `).all();

  const poemShares = await db.prepare(`
    SELECT pst.id, pst.poem_id as resource_id, 'poem' as resource_type,
      p.title, pst.access_count, pst.created_at, pst.status
    FROM poem_share_tokens pst
    LEFT JOIN poems p ON p.id = pst.poem_id
    WHERE pst.share_type = 'demo'
    ORDER BY pst.created_at DESC
  `).all();

  const allShares = [...songShares, ...poemShares].map(s => ({
    ...s,
    share_url: buildDemoShareUrl(s.id, s.resource_type),
  }));

  reply.send({ demo_shares: allShares });
});

app.post("/admin/dashboard/demo-share/:id/revoke", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const shareId = request.params.id;

  // Try song share first
  let share = await db.prepare("SELECT * FROM share_tokens WHERE id = ? AND share_type = 'demo'").get(shareId);
  if (share) {
    await db.prepare("UPDATE share_tokens SET status = 'revoked' WHERE id = ?").run(shareId);
    await adminService._audit(admin.adminId, "admin_revoke_demo_share", "share_token", shareId, {
      resource_type: "song",
      track_id: share.track_id,
    });
    return reply.send({ success: true, revoked: true });
  }

  // Try poem share
  share = await db.prepare("SELECT * FROM poem_share_tokens WHERE id = ? AND share_type = 'demo'").get(shareId);
  if (share) {
    await db.prepare("UPDATE poem_share_tokens SET status = 'revoked' WHERE id = ?").run(shareId);
    await adminService._audit(admin.adminId, "admin_revoke_demo_share", "poem_share_token", shareId, {
      resource_type: "poem",
      poem_id: share.poem_id,
    });
    return reply.send({ success: true, revoked: true });
  }

  sendError(reply, 404, "DEMO_SHARE_NOT_FOUND", "Demo share not found");
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
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { cols.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  cols.push(current.trim());
  return cols;
}

// Read and validate a CSV file upload, returning { lines, filename }
async function readCsvUpload(request, reply, { maxSizeMB = 2, maxRows = 10000 } = {}) {
  const data = await request.file();
  if (!data) {
    sendError(reply, 400, "NO_FILE", "No file uploaded");
    return null;
  }

  const mime = data.mimetype;
  if (mime !== "text/csv" && mime !== "application/vnd.ms-excel" && mime !== "application/octet-stream") {
    sendError(reply, 400, "INVALID_FILE_TYPE", "Only CSV files are accepted");
    return null;
  }

  const maxSize = maxSizeMB * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of data.file) {
    size += chunk.length;
    if (size > maxSize) {
      sendError(reply, 400, "FILE_TOO_LARGE", `CSV must be under ${maxSizeMB}MB`);
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
    sendError(reply, 400, "TOO_MANY_ROWS", `CSV must have fewer than ${maxRows.toLocaleString()} rows`);
    return null;
  }

  return { lines, filename: data.filename || "unknown.csv" };
}

// Normalize email from multiple possible header names
function normalizeEmail(record) {
  return (record.email || record.emailaddress || record.email_address || "").trim().toLowerCase() || null;
}

// OWASP formula injection prevention for CSV export cells
function sanitizeCsvCell(val) {
  if (!val) return "";
  const s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

const TEMPLATE_ALLOWLIST = [
  { id: 'email-1-introduction', file: 'email-1-introduction.html', subject: 'What if your favorite memory became a song?', label: 'The Introduction', day: 'Day 0' },
  { id: 'email-2-social-proof', file: 'email-2-social-proof.html', subject: 'Re: The gift no one expects', label: 'The Social Proof', day: 'Day 3' },
  { id: 'email-3-final-nudge', file: 'email-3-final-nudge.html', subject: "Someone's birthday is coming up", label: 'The Final Nudge', day: 'Day 8' },
];

const CAMPAIGN_TYPES = ['email', 'push', 'social', 'partnership'];
const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sent', 'completed'];

function validateCampaignFields({ type, status, template_id }, reply) {
  if (type && !CAMPAIGN_TYPES.includes(type)) {
    sendError(reply, 400, "INVALID_TYPE", `Type must be one of: ${CAMPAIGN_TYPES.join(", ")}`);
    return false;
  }
  if (status && !CAMPAIGN_STATUSES.includes(status)) {
    sendError(reply, 400, "INVALID_STATUS", `Status must be one of: ${CAMPAIGN_STATUSES.join(", ")}`);
    return false;
  }
  if (template_id && !TEMPLATE_ALLOWLIST.some((t) => t.id === template_id)) {
    sendError(reply, 400, "INVALID_TEMPLATE", "Invalid template ID");
    return false;
  }
  return true;
}

app.get("/admin/dashboard/marketing/email-templates", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const emailsDir = path.join(process.cwd(), "marketing", "emails");
  const templates = await Promise.all(
    TEMPLATE_ALLOWLIST.map(async (tpl) => {
      try {
        const html = await fs.promises.readFile(path.join(emailsDir, tpl.file), "utf8");
        return { ...tpl, html };
      } catch {
        return { ...tpl, html: null, error: "File not found" };
      }
    })
  );
  reply.send({ templates });
});

app.get("/admin/dashboard/marketing/contacts", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const { limit, offset } = parsePagination(request.query);
  const { search, category, status } = request.query;

  let sql = "SELECT * FROM marketing_contacts";
  const conditions = [];
  const params = [];

  if (search) {
    const escaped = escapeLikePattern(search);
    conditions.push("(first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\')");
    params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const contacts = await db.prepare(sql).all(...params);

  // Get total count for pagination
  let countSql = "SELECT COUNT(*) as total FROM marketing_contacts";
  if (conditions.length) countSql += " WHERE " + conditions.join(" AND ");
  const countParams = params.slice(0, params.length - 2); // exclude limit/offset
  const { total } = await db.prepare(countSql).get(...countParams);

  reply.send({ contacts, total, limit, offset });
});

app.post("/admin/dashboard/marketing/contacts/upload", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const csv = await readCsvUpload(request, reply, { maxSizeMB: 2, maxRows: 10000 });
  if (!csv) return;

  const { lines, filename } = csv;

  const KNOWN_HEADERS = new Set([
    "first_name", "last_name", "company_name", "name", "website", "description",
    "contact_name", "email", "emailaddress", "email_address",
    "category", "channel_type", "score", "icp_fit_score", "icp_fit_reasoning",
    "audience_reach", "partnership_opportunity", "contact_approach",
  ]);

  const headers = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = lines.slice(1);

  let inserted = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO marketing_contacts (id, first_name, last_name, company_name, website, description, contact_name, email, category, score, icp_fit_reasoning, audience_reach, partnership_opportunity, contact_approach, source_file, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  const now = nowIso();
  await db.prepare("BEGIN").run();
  try {
    for (const row of rows) {
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
      const contactName = record.contact_name || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null);

      // Dual-path dedup: email takes priority, fallback to company_name+website for legacy B2B records
      if (email) {
        const existing = await db.prepare(
          "SELECT id FROM marketing_contacts WHERE email = ?"
        ).get(email);
        if (existing) { skipped++; continue; }
      } else if (companyName) {
        const existing = await db.prepare(
          "SELECT id FROM marketing_contacts WHERE company_name = ? AND (website = ? OR (website IS NULL AND ? IS NULL))"
        ).get(companyName, website, website);
        if (existing) { skipped++; continue; }
      } else {
        skipped++;
        continue;
      }

      // Sanitize URL — only allow http(s) schemes
      if (website && !/^https?:\/\//i.test(website)) {
        website = null;
      }

      await insertStmt.run(
        newUuid(),
        firstName,
        lastName,
        companyName,
        website,
        record.description || null,
        contactName,
        email,
        record.category || record.channel_type || null,
        parseInt(record.score || record.icp_fit_score) || 0,
        record.icp_fit_reasoning || null,
        record.audience_reach || null,
        record.partnership_opportunity || null,
        record.contact_approach || null,
        filename,
        now,
        now
      );
      inserted++;
    }
    await db.prepare("COMMIT").run();
  } catch (err) {
    await db.prepare("ROLLBACK").run();
    throw err;
  }

  await adminService._audit(admin.adminId, "marketing_contacts_upload", "marketing_contacts", null, {
    filename, inserted, skipped, total_rows: rows.length,
  });

  reply.send({ success: true, inserted, skipped, total: rows.length });
});

app.get("/admin/dashboard/marketing/campaigns", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const campaigns = await db.prepare("SELECT * FROM marketing_campaigns ORDER BY created_at DESC").all();
  reply.send({ campaigns });
});

app.post("/admin/dashboard/marketing/campaigns", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const { name, type, status, template_id, sent_at, recipient_count, notes } = request.body || {};
  if (!name || !name.trim()) {
    return sendError(reply, 400, "MISSING_NAME", "Campaign name is required");
  }
  if (name.trim().length > 200) {
    return sendError(reply, 400, "NAME_TOO_LONG", "Campaign name must not exceed 200 characters");
  }
  if (notes && notes.length > 2000) {
    return sendError(reply, 400, "NOTES_TOO_LONG", "Notes must not exceed 2,000 characters");
  }
  if (!validateCampaignFields({ type, status, template_id }, reply)) return;
  if (recipient_count != null && (recipient_count < 0 || recipient_count > 1000000)) {
    return sendError(reply, 400, "INVALID_COUNT", "Recipient count must be 0-1,000,000");
  }
  if (sent_at && isNaN(new Date(sent_at).getTime())) {
    return sendError(reply, 400, "INVALID_DATE", "sent_at must be a valid ISO date");
  }

  const id = newUuid();
  const now = nowIso();
  await db.prepare(`
    INSERT INTO marketing_campaigns (id, name, type, status, template_id, sent_at, recipient_count, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), type || "email", status || "draft", template_id || null, sent_at || null, recipient_count || 0, notes || null, now, now);

  await adminService._audit(admin.adminId, "marketing_campaign_create", "marketing_campaigns", id, { name: name.trim() });

  const campaign = await db.prepare("SELECT * FROM marketing_campaigns WHERE id = ?").get(id);
  reply.send({ campaign });
});

app.put("/admin/dashboard/marketing/campaigns/:id", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const existing = await db.prepare("SELECT * FROM marketing_campaigns WHERE id = ?").get(request.params.id);
  if (!existing) {
    return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
  }

  const { name, type, status, template_id, sent_at, recipient_count, opens, clicks, replies: repliesCount, bounces, unsubscribes, notes } = request.body || {};

  if (name !== undefined && name.trim().length > 200) {
    return sendError(reply, 400, "NAME_TOO_LONG", "Campaign name must not exceed 200 characters");
  }
  if (notes !== undefined && notes && notes.length > 2000) {
    return sendError(reply, 400, "NOTES_TOO_LONG", "Notes must not exceed 2,000 characters");
  }
  if (!validateCampaignFields({ type, status, template_id }, reply)) return;
  if (sent_at && isNaN(new Date(sent_at).getTime())) {
    return sendError(reply, 400, "INVALID_DATE", "sent_at must be a valid ISO date");
  }

  // Validate numeric stats
  const stats = { recipient_count, opens, clicks, replies: repliesCount, bounces, unsubscribes };
  for (const [key, val] of Object.entries(stats)) {
    if (val != null && (val < 0 || val > 1000000 || !Number.isInteger(val))) {
      return sendError(reply, 400, "INVALID_STAT", `${key} must be a non-negative integer up to 1,000,000`);
    }
  }

  // Build update set from provided fields (allowlisted columns only)
  const ALLOWED_COLUMNS = ['name', 'type', 'status', 'template_id', 'sent_at', 'recipient_count', 'opens', 'clicks', 'replies', 'bounces', 'unsubscribes', 'notes'];
  const candidates = { name: name?.trim(), type, status, template_id, sent_at, recipient_count, opens, clicks, replies: repliesCount, bounces, unsubscribes, notes };
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
  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(updates), request.params.id];
  await db.prepare(`UPDATE marketing_campaigns SET ${setClauses} WHERE id = ?`).run(...values);

  await adminService._audit(admin.adminId, "marketing_campaign_update", "marketing_campaigns", request.params.id, {
    fields_changed: Object.keys(updates).filter((k) => k !== "updated_at"),
  });

  const campaign = await db.prepare("SELECT * FROM marketing_campaigns WHERE id = ?").get(request.params.id);
  reply.send({ campaign });
});

// --- Import GMass Results ---
app.post("/admin/dashboard/marketing/campaigns/:id/import-results", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const campaign = await db.prepare("SELECT * FROM marketing_campaigns WHERE id = ?").get(request.params.id);
  if (!campaign) {
    return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
  }
  if (!["sent", "completed"].includes(campaign.status)) {
    return sendError(reply, 400, "INVALID_STATUS", "Can only import results for sent or completed campaigns");
  }

  const csv = await readCsvUpload(request, reply, { maxSizeMB: 5, maxRows: 50000 });
  if (!csv) return;

  const { lines, filename } = csv;

  const GMASS_HEADERS = new Set([
    "emailaddress", "email", "email_address", "opened", "clicked", "replied", "bounced", "unsubscribed",
  ]);

  const rawHeaders = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = lines.slice(1);

  // Validate that CSV has an email column
  const hasEmailColumn = rawHeaders.some((h) => h === "emailaddress" || h === "email" || h === "email_address");
  if (!hasEmailColumn) {
    return sendError(reply, 400, "MISSING_EMAIL", "CSV must have an EmailAddress or Email column");
  }

  function isEngaged(val) {
    const v = val?.trim().toLowerCase();
    return v === "x" || v === "1" || v === "true";
  }

  let matched = 0;
  let skippedUnknown = 0;
  let bouncedCount = 0;
  let unsubscribedCount = 0;
  const now = nowIso();
  const campaignId = request.params.id;

  await db.prepare("BEGIN").run();
  try {
    for (const row of rows) {
      const cols = parseCsvRow(row);
      const record = Object.create(null);
      rawHeaders.forEach((h, i) => {
        if (GMASS_HEADERS.has(h)) record[h] = cols[i] || null;
      });

      const email = normalizeEmail(record);
      if (!email) { skippedUnknown++; continue; }

      // Match to existing contact
      const contact = await db.prepare("SELECT id, status FROM marketing_contacts WHERE email = ?").get(email);
      if (!contact) { skippedUnknown++; continue; }

      const opened = isEngaged(record.opened) ? 1 : 0;
      const clicked = isEngaged(record.clicked) ? 1 : 0;
      const replied = isEngaged(record.replied) ? 1 : 0;
      const bounced = isEngaged(record.bounced) ? 1 : 0;
      const unsub = isEngaged(record.unsubscribed) ? 1 : 0;

      // Upsert engagement — additive-only (OR-merge: once true, always true)
      await db.prepare(`
        INSERT INTO marketing_engagements (id, contact_id, campaign_id, opened, clicked, replied, bounced, unsubscribed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (contact_id, campaign_id) DO UPDATE SET
          opened = MAX(marketing_engagements.opened, excluded.opened),
          clicked = MAX(marketing_engagements.clicked, excluded.clicked),
          replied = MAX(marketing_engagements.replied, excluded.replied),
          bounced = MAX(marketing_engagements.bounced, excluded.bounced),
          unsubscribed = MAX(marketing_engagements.unsubscribed, excluded.unsubscribed),
          updated_at = excluded.updated_at
      `).run(newUuid(), contact.id, campaignId, opened, clicked, replied, bounced, unsub, now, now);

      // One-directional contact status: bounced/unsubscribed never revert to active
      if (bounced && contact.status === "active") {
        await db.prepare("UPDATE marketing_contacts SET status = 'bounced', updated_at = ? WHERE id = ?").run(now, contact.id);
        bouncedCount++;
      }
      if (unsub && contact.status !== "unsubscribed") {
        await db.prepare("UPDATE marketing_contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ?").run(now, contact.id);
        unsubscribedCount++;
      }

      matched++;
    }

    // Recalculate campaign aggregate stats from engagements
    const stats = await db.prepare(`
      SELECT
        COUNT(*) as recipient_count,
        SUM(opened) as opens,
        SUM(clicked) as clicks,
        SUM(replied) as replies,
        SUM(bounced) as bounces,
        SUM(unsubscribed) as unsubscribes
      FROM marketing_engagements WHERE campaign_id = ?
    `).get(campaignId);

    await db.prepare(`
      UPDATE marketing_campaigns SET
        recipient_count = ?, opens = ?, clicks = ?, replies = ?, bounces = ?, unsubscribes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      stats.recipient_count || 0, stats.opens || 0, stats.clicks || 0,
      stats.replies || 0, stats.bounces || 0, stats.unsubscribes || 0,
      now, campaignId
    );

    await db.prepare("COMMIT").run();
  } catch (err) {
    await db.prepare("ROLLBACK").run();
    throw err;
  }

  await adminService._audit(admin.adminId, "marketing_results_import", "marketing_campaigns", campaignId, {
    filename, matched, skipped: skippedUnknown, bounced: bouncedCount, unsubscribed: unsubscribedCount, total_rows: rows.length,
  });

  reply.send({ success: true, matched, skipped: skippedUnknown, bounced: bouncedCount, unsubscribed: unsubscribedCount, total: rows.length });
});

// --- Campaign Engagements ---
app.get("/admin/dashboard/marketing/campaigns/:id/engagements", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const campaign = await db.prepare("SELECT id FROM marketing_campaigns WHERE id = ?").get(request.params.id);
  if (!campaign) {
    return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
  }

  const { limit, offset } = parsePagination(request.query);
  const { opened, clicked, replied, bounced } = request.query;

  let sql = `
    SELECT mc.id, mc.first_name, mc.last_name, mc.email, mc.status as contact_status,
           me.opened, me.clicked, me.replied, me.bounced, me.unsubscribed
    FROM marketing_engagements me
    JOIN marketing_contacts mc ON mc.id = me.contact_id
    WHERE me.campaign_id = ?
  `;
  const params = [request.params.id];

  let whereExtra = "";
  if (opened !== undefined) { whereExtra += " AND me.opened = ?"; params.push(opened === "true" ? 1 : 0); }
  if (clicked !== undefined) { whereExtra += " AND me.clicked = ?"; params.push(clicked === "true" ? 1 : 0); }
  if (replied !== undefined) { whereExtra += " AND me.replied = ?"; params.push(replied === "true" ? 1 : 0); }
  if (bounced !== undefined) { whereExtra += " AND me.bounced = ?"; params.push(bounced === "true" ? 1 : 0); }
  sql += whereExtra;

  // Count before pagination
  const countSql = `SELECT COUNT(*) as total FROM marketing_engagements me JOIN marketing_contacts mc ON mc.id = me.contact_id WHERE me.campaign_id = ?${whereExtra}`;
  const { total } = await db.prepare(countSql).get(...params);

  sql += " ORDER BY mc.email ASC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const engagements = await db.prepare(sql).all(...params);
  reply.send({ engagements, total, limit, offset });
});

// --- Export Contacts CSV ---
app.get("/admin/dashboard/marketing/contacts/export", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;

  const { status, campaign_id, opened, clicked } = request.query;

  let sql, params;

  if (campaign_id) {
    // Export contacts filtered by engagement with a specific campaign
    sql = `
      SELECT mc.first_name, mc.last_name, mc.email
      FROM marketing_contacts mc
      JOIN marketing_engagements me ON me.contact_id = mc.id AND me.campaign_id = ?
      WHERE mc.status = ?
    `;
    params = [campaign_id, status || "active"];

    if (opened !== undefined) { sql += " AND me.opened = ?"; params.push(opened === "true" ? 1 : 0); }
    if (clicked !== undefined) { sql += " AND me.clicked = ?"; params.push(clicked === "true" ? 1 : 0); }
  } else {
    // Export all contacts with status filter
    sql = "SELECT first_name, last_name, email FROM marketing_contacts WHERE status = ?";
    params = [status || "active"];
  }

  sql += " ORDER BY email ASC";
  const contacts = await db.prepare(sql).all(...params);

  // Build CSV
  const csvLines = ["First Name,Last Name,Email"];
  for (const c of contacts) {
    csvLines.push(
      `${sanitizeCsvCell(c.first_name)},${sanitizeCsvCell(c.last_name)},${sanitizeCsvCell(c.email)}`
    );
  }

  await adminService._audit(admin.adminId, "marketing_contacts_export", "marketing_contacts", null, {
    filters: { status, campaign_id, opened, clicked }, row_count: contacts.length,
  });

  reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="contacts-export-${new Date().toISOString().slice(0, 10)}.csv"`)
    .header("Cache-Control", "no-store")
    .send(csvLines.join("\n"));
});

// Phase 2: Step history API — per-job step execution timeline
app.get("/admin/dashboard/jobs/:id/steps", async (request, reply) => {
  const admin = await requireAdminSession(request, reply);
  if (!admin) return;
  const steps = await adminService.getJobStepHistory(request.params.id);
  reply.send({ steps });
});

// Admin SPA catch-all - serves index.html for client-side routing
// Must come AFTER all /admin/* API routes so they take precedence
// Using fs.readFile instead of reply.sendFile because decorateReply: false on static registrations
const adminIndexPath = path.join(process.cwd(), "public/admin/index.html");

app.get("/admin", async (request, reply) => {
  const fs = require("fs").promises;
  const content = await fs.readFile(adminIndexPath, "utf8");
  return reply.type("text/html").send(content);
});

app.get("/admin/*", async (request, reply) => {
  // Handles client-side routes: /admin/login, /admin/users, /admin/jobs, etc.
  const fs = require("fs").promises;
  const content = await fs.readFile(adminIndexPath, "utf8");
  return reply.type("text/html").send(content);
});

return { requireAdminRole };
}

module.exports = { registerAdminRoutes };
