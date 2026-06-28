"use strict";

function isValidVersionString(value) {
  return /^\d+(?:\.\d+){0,3}$/.test(value);
}

function registerAdminSecurityConfigRoutes(
  app,
  { adminService, requireAdminRole, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSecurityConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const config = request.body;

    const sessionHours = parseInt(config.sessionDurationHours);
    const maxAttempts = parseInt(config.maxFailedLoginAttempts);
    const lockoutMins = parseInt(config.lockoutDurationMinutes);

    if (
      !Number.isInteger(sessionHours) ||
      sessionHours < 1 ||
      sessionHours > 720
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "sessionDurationHours must be between 1 and 720",
      );
      return;
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "maxFailedLoginAttempts must be between 1 and 20",
      );
      return;
    }
    if (
      !Number.isInteger(lockoutMins) ||
      lockoutMins < 1 ||
      lockoutMins > 1440
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "lockoutDurationMinutes must be between 1 and 1440",
      );
      return;
    }
    if (
      config.rateLimitDefaults &&
      typeof config.rateLimitDefaults !== "object"
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "rateLimitDefaults must be an object",
      );
      return;
    }
    if (
      config.iosMinSupportedVersion &&
      !isValidVersionString(String(config.iosMinSupportedVersion).trim())
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosMinSupportedVersion must look like 1.2.3",
      );
      return;
    }
    if (
      config.iosRecommendedVersion &&
      !isValidVersionString(String(config.iosRecommendedVersion).trim())
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosRecommendedVersion must look like 1.2.3",
      );
      return;
    }
    if (
      config.iosUpdateMessage &&
      String(config.iosUpdateMessage).length > 280
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosUpdateMessage must be 280 characters or fewer",
      );
      return;
    }
    if (
      config.iosAutoRecommendedVersion != null &&
      typeof config.iosAutoRecommendedVersion !== "boolean"
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosAutoRecommendedVersion must be true or false",
      );
      return;
    }

    const sanitizedConfig = {
      sessionDurationHours: sessionHours,
      maxFailedLoginAttempts: maxAttempts,
      lockoutDurationMinutes: lockoutMins,
      rateLimitDefaults: config.rateLimitDefaults || {},
      iosMinSupportedVersion: String(
        config.iosMinSupportedVersion || "",
      ).trim(),
      iosRecommendedVersion: String(config.iosRecommendedVersion || "").trim(),
      iosUpdateMessage: String(config.iosUpdateMessage || "").trim(),
      iosAutoRecommendedVersion: Boolean(config.iosAutoRecommendedVersion),
      iosLastAppStoreVersion: String(
        config.iosLastAppStoreVersion || "",
      ).trim(),
      iosLastAppStoreSyncAt: String(config.iosLastAppStoreSyncAt || "").trim(),
      iosAppStoreSyncError: String(config.iosAppStoreSyncError || "").trim(),
    };

    const result = await adminService.updateSecurityConfig(
      sanitizedConfig,
      admin.adminId,
    );
    reply.send(result);
  });

  app.post(
    "/admin/dashboard/security/config/sync-ios-version",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      try {
        const result = await adminService.syncIOSVersionFromAppStore(
          admin.adminId,
          { force: true },
        );
        reply.send(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "App Store Connect sync failed";
        sendError(reply, 502, "APP_STORE_SYNC_FAILED", message);
      }
    },
  );
}

module.exports = { registerAdminSecurityConfigRoutes };
