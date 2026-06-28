"use strict";

function registerAdminShareRoutes(
  app,
  { adminService, parsePagination, requireAdminRole, requireAdminSession, sendError },
) {
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
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;
    const { newDeviceId, reason } = request.body || {};
    if (!newDeviceId) {
      sendError(reply, 400, "INVALID_PARAMS", "newDeviceId is required");
      return;
    }
    const result = await adminService.rebindShare(
      request.params.id,
      newDeviceId,
      admin.adminId,
      reason || "",
    );
    if (!result.success) {
      sendError(reply, 400, "REBIND_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

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

  app.post(
    "/admin/dashboard/poem-share/:id/reset-attempts",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, [
        "admin",
        "superadmin",
      ]);
      if (!admin) return;
      const { reason } = request.body || {};
      const result = await adminService.resetPoemShareAttempts(
        request.params.id,
        admin.adminId,
        reason || "",
      );
      if (!result.success) {
        sendError(reply, 400, "RESET_ERROR", result.error);
        return;
      }
      reply.send(result);
    },
  );

  app.post("/admin/dashboard/poem-share/:id/revoke", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.revokePoemShare(
      request.params.id,
      admin.adminId,
      reason || "",
    );
    if (!result.success) {
      sendError(reply, 400, "REVOKE_ERROR", result.error);
      return;
    }
    reply.send(result);
  });
}

module.exports = { registerAdminShareRoutes };
