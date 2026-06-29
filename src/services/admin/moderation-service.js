"use strict";

const { safeBounds } = require("./pagination");

function createAdminModerationService({
  adminModerationRepository,
  audit,
}) {
  if (!adminModerationRepository) {
    throw new Error("adminModerationRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function getModerationQueue({ limit = 50, offset = 0 } = {}) {
    const bounds = safeBounds(limit, offset);
    return await adminModerationRepository.listBlockedVersions(bounds);
  }

  async function overrideModeration(versionId, adminId, reason) {
    const result = await adminModerationRepository.approveBlockedVersion({
      versionId,
      reason,
    });

    if (result.status === "not_found") {
      return { success: false, error: "Track version not found" };
    }
    if (result.status === "not_blocked") {
      return {
        success: false,
        error: "Track version is not blocked",
        moderationStatus: result.moderationStatus,
      };
    }

    await audit(
      adminId,
      "admin_moderation_override",
      "track_version",
      versionId,
      { reason },
    );
    return { success: true };
  }

  return {
    getModerationQueue,
    overrideModeration,
  };
}

module.exports = {
  createAdminModerationService,
};
