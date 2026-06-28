"use strict";

function registerAdminJobOpsRoutes(
  app,
  { adminService, parsePagination, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/jobs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, workflowType } = request.query;
    reply.send({
      jobs: await adminService.listJobs({
        status,
        workflowType,
        ...parsePagination(request.query),
      }),
    });
  });

  app.post("/admin/dashboard/jobs/:id/retry", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;
    const result = await adminService.retryJob(
      request.params.id,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "RETRY_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  app.get("/admin/dashboard/dlq", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send({
      entries: await adminService.listDLQ(parsePagination(request.query)),
    });
  });

  app.post("/admin/dashboard/dlq/:id/reprocess", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.reprocessDLQ(
      request.params.id,
      admin.adminId,
      reason || "Admin reprocess",
    );
    if (!result.success) {
      sendError(reply, 400, "DLQ_REPROCESS_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  app.get("/admin/dashboard/jobs/:id/steps", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const steps = await adminService.getJobStepHistory(request.params.id);
    reply.send({ steps });
  });
}

module.exports = { registerAdminJobOpsRoutes };
