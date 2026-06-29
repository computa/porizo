"use strict";

function registerAdminAnalyticsRoutes(app, { analyticsService, requireAdminSession }) {
  // These surface iOS-emitted funnel events (auth_completed, create_started,
  // create_completed, first_song_completed, session_resumed) plus server-side
  // events (share_create etc) from the events table. All responses except
  // /user/:userId are cached 60s in AdminAnalyticsService. /user/:userId writes an
  // audit_logs row on every call, so admin reads of user behavioral data remain
  // traceable.
  app.get("/admin/dashboard/analytics/overview", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const overview = await analyticsService.getAnalyticsOverview(
      request.query.days,
    );
    reply.send(overview);
  });

  app.get("/admin/dashboard/analytics/funnel", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const funnel = await analyticsService.getFunnelCohort(request.query.days);
    reply.send(funnel);
  });

  app.get(
    "/admin/dashboard/analytics/daily/:eventName",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const daily = await analyticsService.getAnalyticsDaily(
        request.params.eventName,
        request.query.days,
      );
      reply.send(daily);
    },
  );

  app.get("/admin/dashboard/analytics/user/:userId", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const userAnalytics = await analyticsService.getUserAnalytics(
      admin.adminId,
      admin.email,
      request.params.userId,
      request.query.limit,
    );
    reply.send(userAnalytics);
  });
}

module.exports = { registerAdminAnalyticsRoutes };
