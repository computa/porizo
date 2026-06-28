"use strict";

function registerAdminMetricsRoutes(app, { adminService, requireAdminSession }) {
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

  app.get(
    "/admin/dashboard/metrics/render-pipeline",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      reply.send(await adminService.getRenderSuccessMetrics());
    },
  );

  app.get("/admin/dashboard/security/risk-metrics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getRiskMetrics());
  });
}

module.exports = { registerAdminMetricsRoutes };
