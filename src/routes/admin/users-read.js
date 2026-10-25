"use strict";

const REGISTRATION_STATUSES = new Set([
  "registered",
  "guest",
  "unclaimed",
  "deleted",
  "all",
]);

function registerAdminUserReadRoutes(
  app,
  { userReadService, parsePagination, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/users", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const {
      email,
      userId,
      riskLevel,
      tier,
      registrationStatus = "registered",
      trackId,
      shareId,
      recipientName,
    } = request.query;
    if (!REGISTRATION_STATUSES.has(registrationStatus)) {
      sendError(
        reply,
        400,
        "INVALID_FILTER",
        "registrationStatus must be registered, guest, unclaimed, deleted, or all",
      );
      return;
    }
    const result = await userReadService.searchUsers({
      email,
      userId,
      riskLevel,
      tier,
      registrationStatus,
      trackId,
      shareId,
      recipientName,
      ...parsePagination(request.query),
    });
    reply.send(result);
  });

  app.get("/admin/dashboard/users/stats", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const stats = await userReadService.getUserStats();
    reply.send(stats);
  });

  app.get("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await userReadService.getUserDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "User not found");
      return;
    }
    reply.send(detail);
  });
}

module.exports = { registerAdminUserReadRoutes };
