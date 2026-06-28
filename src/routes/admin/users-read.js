"use strict";

function registerAdminUserReadRoutes(
  app,
  { adminService, parsePagination, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/users", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { email, userId, riskLevel, tier, trackId, shareId, recipientName } =
      request.query;
    const result = await adminService.searchUsers({
      email,
      userId,
      riskLevel,
      tier,
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
    const stats = await adminService.getUserStats();
    reply.send(stats);
  });

  app.get("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await adminService.getUserDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "User not found");
      return;
    }
    reply.send(detail);
  });
}

module.exports = { registerAdminUserReadRoutes };
