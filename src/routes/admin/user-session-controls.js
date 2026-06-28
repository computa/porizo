"use strict";

function registerAdminUserSessionControlRoutes(
  app,
  { adminService, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/users/:userId/sessions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { userId } = request.params;
    const sessions = await adminService.getUserSessions(userId);
    reply.send({ sessions });
  });

  app.post(
    "/admin/dashboard/users/:userId/sessions/:sessionId/revoke",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId, sessionId } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.revokeUserSession(
        userId,
        sessionId,
        admin.adminId,
        reason || "Admin revocation",
      );
      if (!result.success) {
        sendError(reply, 404, "SESSION_NOT_FOUND", result.error);
        return;
      }
      reply.send(result);
    },
  );

  app.post(
    "/admin/dashboard/users/:userId/sessions/revoke-all",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.revokeAllUserSessions(
        userId,
        admin.adminId,
        reason || "Admin revocation",
      );
      reply.send(result);
    },
  );

  app.post(
    "/admin/dashboard/users/:userId/voice/force-reverify",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.forceVoiceReverify(
        userId,
        admin.adminId,
        reason || "Admin-initiated re-verification",
      );
      if (!result.success) {
        sendError(reply, 404, "VOICE_PROFILE_NOT_FOUND", result.error);
        return;
      }
      reply.send(result);
    },
  );
}

module.exports = { registerAdminUserSessionControlRoutes };
