"use strict";

function registerAdminGrowthRoutes(
  app,
  { adminService, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/growth/attribution", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days, 10) || 30;
    const attribution = await adminService.getAttribution(days);
    reply.send(attribution);
  });

  app.get(
    "/admin/dashboard/growth/apple-ads-keyword-map",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const keywordMap = await adminService.getAppleAdsKeywordMap({
        limit: request.query.limit,
        offset: request.query.offset,
      });
      reply.send(keywordMap);
    },
  );

  app.post(
    "/admin/dashboard/growth/apple-ads-keyword-map",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      try {
        const rows = request.body?.keywords ?? request.body?.rows;
        const result = await adminService.upsertAppleAdsKeywordMap(
          rows,
          admin.adminId,
        );
        reply.send(result);
      } catch (error) {
        sendError(
          reply,
          400,
          "INVALID_KEYWORD_MAP",
          error.message || "Invalid Apple Ads keyword map payload",
        );
      }
    },
  );

  app.get("/admin/dashboard/growth/teasers", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days, 10) || 7;
    const metrics = await adminService.getTeaserMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/growth/shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days, 10) || 30;
    const metrics = await adminService.getShareMetrics(days);
    reply.send(metrics);
  });
}

module.exports = { registerAdminGrowthRoutes };
