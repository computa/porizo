"use strict";

function registerAdminMetricsRoutes(
  app,
  { jobOpsService, metricsService, requireAdminSession },
) {
  app.get("/admin/dashboard/metrics/overview", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await metricsService.getOverviewMetrics());
  });

  app.get("/admin/dashboard/metrics/jobs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await jobOpsService.getJobMetrics());
  });

  app.get("/admin/dashboard/metrics/costs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { days } = request.query;
    reply.send(await metricsService.getCostMetrics(days ? parseInt(days) : 30));
  });

  app.get("/admin/dashboard/metrics/enrollment", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await metricsService.getEnrollmentMetrics());
  });

  app.get(
    "/admin/dashboard/metrics/render-pipeline",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      reply.send(await metricsService.getRenderSuccessMetrics());
    },
  );

  app.get("/admin/dashboard/security/risk-metrics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await metricsService.getRiskMetrics());
  });
}

module.exports = { registerAdminMetricsRoutes };
