"use strict";

function isOnboardingSampleValidationError(err) {
  return (
    err.message.includes("is required") ||
    err.message.includes("No valid fields") ||
    err.message.includes("must start with") ||
    err.message.includes("must be")
  );
}

function registerAdminOnboardingSampleRoutes(
  app,
  { adminService, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/onboarding-samples", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const samples = await adminService.getOnboardingSamples();
      reply.send({ samples });
    } catch (err) {
      request.log.error({ err }, "[Admin] Get onboarding samples error");
      sendError(reply, 500, "ONBOARDING_SAMPLES_ERROR", err.message);
    }
  });

  app.post("/admin/dashboard/onboarding-samples", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { label, audio_url } = request.body || {};

    try {
      const sample = await adminService.createOnboardingSample(
        { label, audio_url },
        admin.adminId,
      );
      reply.send({ success: true, sample });
    } catch (err) {
      if (isOnboardingSampleValidationError(err)) {
        sendError(reply, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      request.log.error({ err }, "[Admin] Create onboarding sample error");
      sendError(reply, 500, "CREATE_ERROR", "An internal error occurred.");
    }
  });

  app.put("/admin/dashboard/onboarding-samples/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const updates = request.body || {};

    try {
      const sample = await adminService.updateOnboardingSample(
        id,
        updates,
        admin.adminId,
      );
      reply.send({ success: true, sample });
    } catch (err) {
      if (err.message === "Onboarding sample not found") {
        sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
        return;
      }
      if (isOnboardingSampleValidationError(err)) {
        sendError(reply, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      request.log.error({ err }, "[Admin] Update onboarding sample error");
      sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
    }
  });

  app.put(
    "/admin/dashboard/onboarding-samples/:id/activate",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { id } = request.params;

      try {
        const sample = await adminService.activateOnboardingSample(
          id,
          admin.adminId,
        );
        reply.send({ success: true, sample });
      } catch (err) {
        if (err.message === "Onboarding sample not found") {
          sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
          return;
        }
        request.log.error({ err }, "[Admin] Activate onboarding sample error");
        sendError(reply, 500, "ACTIVATE_ERROR", "An internal error occurred.");
      }
    },
  );

  app.delete(
    "/admin/dashboard/onboarding-samples/:id",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { id } = request.params;

      try {
        const result = await adminService.deleteOnboardingSample(
          id,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        if (err.message === "Onboarding sample not found") {
          sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
          return;
        }
        request.log.error({ err }, "[Admin] Delete onboarding sample error");
        sendError(reply, 500, "DELETE_ERROR", "An internal error occurred.");
      }
    },
  );
}

module.exports = { registerAdminOnboardingSampleRoutes };
