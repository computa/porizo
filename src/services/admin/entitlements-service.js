"use strict";

const VALID_TIERS = ["free", "trial", "pro", "plus"];

function createAdminEntitlementsService({
  adminEntitlementsRepository,
  audit,
  now = () => new Date(),
}) {
  if (!adminEntitlementsRepository) {
    throw new Error("adminEntitlementsRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowIso() {
    const value = now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  async function updateUserEntitlements(userId, fields, adminId) {
    if (fields.tier && !VALID_TIERS.includes(fields.tier)) {
      return {
        success: false,
        error: `tier must be one of: ${VALID_TIERS.join(", ")}`,
      };
    }

    if (!fields.tier) {
      return { success: false, error: "No valid fields provided" };
    }

    const current = await adminEntitlementsRepository.upsertTier(
      userId,
      fields.tier,
      nowIso(),
    );

    await audit(adminId, "admin_update_entitlements", "user", userId, {
      previous: current || { tier: "free" },
      updated: { tier: fields.tier },
    });

    return { success: true };
  }

  return {
    updateUserEntitlements,
  };
}

module.exports = {
  VALID_TIERS,
  createAdminEntitlementsService,
};
