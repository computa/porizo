"use strict";

const PROFILE_FIELDS = [
  "display_name",
  "email",
  "phone_number",
  "acquisition_source",
  "acquisition_medium",
  "acquisition_campaign",
  "acquisition_content",
  "acquisition_term",
  "acquisition_country",
  "acquisition_referrer",
];

const ATTRIBUTION_FIELDS = [
  "acquisition_source",
  "acquisition_medium",
  "acquisition_campaign",
  "acquisition_content",
  "acquisition_term",
  "acquisition_country",
  "acquisition_referrer",
];

const EMPTY_ATTRIBUTION = {
  acquisition_source: null,
  acquisition_medium: null,
  acquisition_campaign: null,
  acquisition_content: null,
  acquisition_term: null,
  acquisition_country: null,
  acquisition_referrer: null,
  acquisition_at: null,
};

function createAdminUserMutationService({
  adminUserMutationRepository,
  audit,
  now = () => new Date(),
}) {
  if (!adminUserMutationRepository) {
    throw new Error("adminUserMutationRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowMs() {
    const value = now();
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
  }

  async function updateUserRisk(userId, riskLevel, adminId, reason) {
    await adminUserMutationRepository.updateRiskLevel(userId, riskLevel);
    await audit(adminId, "admin_update_risk", "user", userId, {
      riskLevel,
      reason,
    });
    return { success: true };
  }

  async function lockUser(userId, locked, adminId, reason) {
    const lockedUntil = locked
      ? new Date(nowMs() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await adminUserMutationRepository.updateLockedUntil(userId, lockedUntil);
    await audit(
      adminId,
      locked ? "admin_lock_user" : "admin_unlock_user",
      "user",
      userId,
      { reason },
    );

    return { success: true, lockedUntil };
  }

  async function deleteUser(userId, adminId, reason) {
    const user = await adminUserMutationRepository.findDeletionSnapshot(userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    await audit(adminId, "admin_delete_user", "user", userId, {
      reason,
      deleted_email: user.email,
      deleted_display_name: user.display_name,
    });

    await adminUserMutationRepository.deleteUser(userId);

    return {
      success: true,
      deleted: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    };
  }

  async function bulkUserAction(userIds, action, adminId, reason) {
    const validActions = ["delete", "lock", "unlock"];
    if (!validActions.includes(action)) {
      return {
        succeeded: [],
        failed: [{ userId: null, error: `Invalid action: ${action}` }],
      };
    }
    if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 50) {
      return {
        succeeded: [],
        failed: [
          { userId: null, error: "userIds must be an array of 1-50 IDs" },
        ],
      };
    }

    const succeeded = [];
    const failed = [];

    for (const userId of userIds) {
      try {
        if (action === "delete") {
          const result = await deleteUser(
            userId,
            adminId,
            reason || "Bulk deletion",
          );
          if (result.success) {
            succeeded.push(userId);
          } else {
            failed.push({ userId, error: result.error });
          }
        } else {
          const locked = action === "lock";
          await lockUser(userId, locked, adminId, reason || `Bulk ${action}`);
          succeeded.push(userId);
        }
      } catch (err) {
        failed.push({ userId, error: err.message });
      }
    }

    await audit(adminId, `admin_bulk_${action}`, "user", "bulk", {
      action,
      requestedCount: userIds.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      reason,
    });

    return { succeeded, failed };
  }

  function filterAllowedFields(fields, allowedFields) {
    const updates = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        updates[key] = fields[key];
      }
    }
    return updates;
  }

  async function updateUserProfile(userId, fields, adminId) {
    const updates = filterAllowedFields(fields, PROFILE_FIELDS);

    if (Object.keys(updates).length === 0) {
      return { success: false, error: "No valid fields provided" };
    }

    const attributionUpdates = filterAllowedFields(updates, ATTRIBUTION_FIELDS);
    const hasAttributionUpdates = Object.keys(attributionUpdates).length > 0;
    const previousAttribution = hasAttributionUpdates
      ? await adminUserMutationRepository.getAttributionSnapshot(userId)
      : null;

    await adminUserMutationRepository.updateUserFields(userId, updates);
    await audit(adminId, "admin_update_user_profile", "user", userId, {
      changedFields: updates,
    });

    if (hasAttributionUpdates) {
      const nextAttribution =
        await adminUserMutationRepository.getAttributionSnapshot(userId);
      await audit(adminId, "admin_update_user_attribution", "user", userId, {
        contract: "attribution-source-precedence-v1",
        previous: previousAttribution || EMPTY_ATTRIBUTION,
        next: nextAttribution || EMPTY_ATTRIBUTION,
        changedFields: attributionUpdates,
      });
    }

    return { success: true, updated: updates };
  }

  return {
    updateUserRisk,
    lockUser,
    deleteUser,
    bulkUserAction,
    updateUserProfile,
  };
}

module.exports = {
  ATTRIBUTION_FIELDS,
  EMPTY_ATTRIBUTION,
  PROFILE_FIELDS,
  createAdminUserMutationService,
};
