"use strict";

function registerAdminKpiRoutes(app, { db, requireAdminSession }) {
  app.get("/admin/dashboard/kpis", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days, 10) || 30;
    const { getKPIAggregates } = require("../../jobs/compute-daily-aggregates");
    const aggregates = await getKPIAggregates(db, days);
    reply.send({ aggregates });
  });

  app.get("/admin/dashboard/kpis/trends", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const {
      getKPITrends,
      ensureRecentAggregates,
    } = require("../../jobs/compute-daily-aggregates");
    await ensureRecentAggregates(db, 14);
    const trends = await getKPITrends(db);
    reply.send(trends);
  });
}

module.exports = { registerAdminKpiRoutes };
