"use strict";

const { safeBounds } = require("./pagination");

function createAdminShareManagementService({
  adminShareManagementRepository,
  audit,
}) {
  if (!adminShareManagementRepository) {
    throw new Error("adminShareManagementRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function listShares({
    status,
    trackId,
    userId,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return await adminShareManagementRepository.listShares({
      status,
      trackId,
      userId,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function rebindShare(shareId, newDeviceId, adminId, reason) {
    const share = await adminShareManagementRepository.getShareById(shareId);
    if (!share) return { success: false, error: "Share not found" };

    const oldDeviceId = share.bound_device_id;
    await adminShareManagementRepository.rebindShareDevice({
      shareId,
      newDeviceId,
    });
    await audit(adminId, "share_rebound", "share_token", shareId, {
      oldDeviceId,
      newDeviceId,
      reason,
    });
    return { success: true, oldDeviceId, newDeviceId };
  }

  async function listPoemShares({
    status,
    poemId,
    userId,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return await adminShareManagementRepository.listPoemShares({
      status,
      poemId,
      userId,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function resetPoemShareAttempts(shareId, adminId, reason) {
    const share =
      await adminShareManagementRepository.getPoemShareById(shareId);
    if (!share) return { success: false, error: "Poem share not found" };

    const oldAttempts = share.claim_attempts;
    await adminShareManagementRepository.resetPoemShareAttempts(shareId);
    await audit(
      adminId,
      "poem_share_attempts_reset",
      "poem_share_token",
      shareId,
      { oldAttempts, reason },
    );
    return { success: true, oldAttempts };
  }

  async function revokePoemShare(shareId, adminId, reason) {
    const share =
      await adminShareManagementRepository.getPoemShareById(shareId);
    if (!share) return { success: false, error: "Poem share not found" };
    if (share.status === "revoked") {
      return { success: false, error: "Already revoked" };
    }

    const oldStatus = share.status;
    await adminShareManagementRepository.revokePoemShare(shareId);
    await audit(adminId, "poem_share_revoked", "poem_share_token", shareId, {
      oldStatus,
      reason,
    });
    return { success: true, oldStatus };
  }

  return {
    listShares,
    rebindShare,
    listPoemShares,
    resetPoemShareAttempts,
    revokePoemShare,
  };
}

module.exports = {
  createAdminShareManagementService,
};
