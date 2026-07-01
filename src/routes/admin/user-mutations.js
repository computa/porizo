"use strict";

function registerAdminUserMutationRoutes(
  app,
  { requireAdminRole, requireAdminSession, sendError, userMutationService },
) {
  app.put("/admin/dashboard/users/:id/risk", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { riskLevel, reason } = request.body || {};
    if (!riskLevel || !["low", "medium", "high"].includes(riskLevel)) {
      sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "riskLevel must be low, medium, or high",
      );
      return;
    }
    const result = await userMutationService.updateUserRisk(
      request.params.id,
      riskLevel,
      admin.adminId,
      reason || "",
    );
    reply.send(result);
  });

  app.post("/admin/dashboard/users/:id/lock", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { locked, reason } = request.body || {};
    const result = await userMutationService.lockUser(
      request.params.id,
      Boolean(locked),
      admin.adminId,
      reason || "",
    );
    reply.send(result);
  });

  app.delete("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await userMutationService.deleteUser(
      request.params.id,
      admin.adminId,
      reason || "Admin deletion",
    );
    if (!result.success) {
      sendError(reply, 404, "USER_NOT_FOUND", result.error);
      return;
    }
    reply.send(result);
  });

  app.post("/admin/dashboard/users/bulk-action", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { action, userIds, reason } = request.body || {};
    if (!action || !Array.isArray(userIds) || userIds.length === 0) {
      sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "action and userIds[] are required",
      );
      return;
    }
    const result = await userMutationService.bulkUserAction(
      userIds,
      action,
      admin.adminId,
      reason || "",
    );
    reply.send(result);
  });

  app.put("/admin/dashboard/users/:id/profile", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const fields = request.body || {};
    const result = await userMutationService.updateUserProfile(
      request.params.id,
      fields,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });
}

module.exports = { registerAdminUserMutationRoutes };
