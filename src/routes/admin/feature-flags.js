"use strict";

function registerAdminFeatureFlagRoutes(
  app,
  { adminService, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/feature-flags", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    try {
      const flags = await adminService.getAllFeatureFlags();
      reply.send(flags);
    } catch (err) {
      console.error(
        "[Admin] FF_GET_ERROR: Failed to get feature flags:",
        err.message,
      );
      sendError(
        reply,
        500,
        "FEATURE_FLAGS_ERROR",
        "Failed to load feature flags. Please try again.",
      );
    }
  });

  app.put("/admin/dashboard/feature-flags", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const updates = request.body || {};

    if (typeof updates !== "object" || Object.keys(updates).length === 0) {
      return sendError(
        reply,
        400,
        "INVALID_REQUEST",
        "Request body must be an object with flag updates",
      );
    }

    try {
      const result = await adminService.updateFeatureFlags(
        updates,
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      console.error(
        "[Admin] FF_UPDATE_ERROR: Failed to update feature flags:",
        err.message,
      );
      sendError(
        reply,
        500,
        "FEATURE_FLAGS_ERROR",
        "Failed to save feature flags. Please try again.",
      );
    }
  });
}

module.exports = { registerAdminFeatureFlagRoutes };
