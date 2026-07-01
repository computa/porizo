"use strict";

function registerAdminModerationRoutes(
  app,
  {
    moderationService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
    validateReason,
  },
) {
  app.get("/admin/dashboard/moderation/queue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send({
      items: await moderationService.getModerationQueue(
        parsePagination(request.query),
      ),
    });
  });

  app.post(
    "/admin/dashboard/moderation/:versionId/override",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { reason } = request.body || {};
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) {
        return;
      }
      const result = await moderationService.overrideModeration(
        request.params.versionId,
        admin.adminId,
        trimmedReason,
      );
      if (!result.success) {
        const code =
          result.error === "Track version not found"
            ? "TRACK_VERSION_NOT_FOUND"
            : "TRACK_VERSION_NOT_BLOCKED";
        const statusCode = code === "TRACK_VERSION_NOT_FOUND" ? 404 : 409;
        sendError(reply, statusCode, code, result.error);
        return;
      }
      reply.send(result);
    },
  );
}

module.exports = { registerAdminModerationRoutes };
