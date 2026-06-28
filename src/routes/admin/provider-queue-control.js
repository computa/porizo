"use strict";

function registerAdminProviderQueueControlRoutes(
  app,
  { adminService, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/providers", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const providers = await adminService.getProviderStatus();
    reply.send({ providers });
  });

  app.post(
    "/admin/dashboard/providers/:providerName/status",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { providerName } = request.params;
      const { status, reason } = request.body || {};

      if (!["active", "paused", "disabled"].includes(status)) {
        sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Status must be active, paused, or disabled",
        );
        return;
      }

      const result = await adminService.setProviderStatus(
        providerName,
        status,
        admin.adminId,
        reason,
      );
      reply.send(result);
    },
  );

  app.get("/admin/dashboard/queues", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const queues = await adminService.getQueueStatus();
    reply.send({ queues });
  });

  app.post(
    "/admin/dashboard/queues/:queueName/status",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { queueName } = request.params;
      const { status, reason } = request.body || {};

      if (!["active", "paused", "draining"].includes(status)) {
        sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Status must be active, paused, or draining",
        );
        return;
      }

      const result = await adminService.setQueueStatus(
        queueName,
        status,
        admin.adminId,
        reason,
      );
      reply.send(result);
    },
  );
}

module.exports = { registerAdminProviderQueueControlRoutes };
