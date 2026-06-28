"use strict";

function registerAdminMusicDiagnosticsRoutes(
  app,
  { adminService, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/music/diagnostics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const limit = parseInt(request.query.limit, 10) || 30;
    const provider =
      typeof request.query.provider === "string"
        ? request.query.provider
        : null;
    const status =
      typeof request.query.status === "string" ? request.query.status : null;

    try {
      const diagnostics = await adminService.getRecentMusicDiagnostics({
        limit,
        provider,
        status,
      });
      reply.send(diagnostics);
    } catch (err) {
      sendError(
        reply,
        500,
        "MUSIC_DIAGNOSTICS_ERROR",
        "Failed to load music diagnostics.",
      );
    }
  });
}

module.exports = { registerAdminMusicDiagnosticsRoutes };
