"use strict";

function registerAdminSecurityObservabilityRoutes(
  app,
  {
    adminService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
  },
) {
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
      eventType,
      userId,
      startDate,
      endDate,
      ...parsePagination(request.query),
    });
    reply.send({ events });
  });

  app.get(
    "/admin/dashboard/security/auth-events/stats",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const stats = await adminService.getAuthEventStats();
      reply.send(stats);
    },
  );

  app.get("/admin/dashboard/security/apple-refresh", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { days } = request.query;
    const stats = await adminService.getAppleRefreshTokenStats(
      Number(days) || 7,
    );
    reply.send(stats);
  });

  app.get("/admin/dashboard/security/audit-logs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { action, resourceType, startDate, endDate } = request.query;
    const logs = await adminService.searchAuditLogs({
      action,
      resourceType,
      startDate,
      endDate,
      ...parsePagination(request.query),
    });
    reply.send({ logs });
  });

  app.get("/admin/dashboard/security/rate-limits", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { userId, actionType, nearLimit } = request.query;
    const limits = await adminService.getRateLimits({
      userId,
      actionType,
      nearLimit: nearLimit === "true",
      ...parsePagination(request.query),
    });
    reply.send({ limits });
  });

  app.post(
    "/admin/dashboard/security/rate-limits/:userId/:actionType/reset",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId, actionType } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.resetUserRateLimit(
        userId,
        actionType,
        admin.adminId,
        reason || "Admin reset",
      );
      reply.send(result);
    },
  );

  app.get("/admin/dashboard/security/consent-logs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { consentVersion, startDate, endDate } = request.query;
    const consents = await adminService.getConsentLogs({
      consentVersion,
      startDate,
      endDate,
      ...parsePagination(request.query),
    });
    reply.send({ consents });
  });
}

module.exports = { registerAdminSecurityObservabilityRoutes };
