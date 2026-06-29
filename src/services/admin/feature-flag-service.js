"use strict";

const defaultFeatureFlags = require("../feature-flags");

function transformMetadataOptions(meta) {
  if (!meta || !Array.isArray(meta.options)) {
    return { ...(meta || {}) };
  }
  return {
    ...meta,
    options: meta.options.map((option) =>
      typeof option === "string" ? { value: option, label: option } : option,
    ),
  };
}

function validateFlagValue({ flagId, value, meta }) {
  if (!meta) {
    return null;
  }
  if (meta.type === "number") {
    const numValue = Number(value);
    if (Number.isNaN(numValue)) {
      return { flagId, error: "Value must be a number" };
    }
    if (meta.min !== undefined && numValue < meta.min) {
      return { flagId, error: `Value must be >= ${meta.min}` };
    }
    if (meta.max !== undefined && numValue > meta.max) {
      return { flagId, error: `Value must be <= ${meta.max}` };
    }
  } else if (meta.type === "boolean" && typeof value !== "boolean") {
    return { flagId, error: "Value must be a boolean" };
  }
  return null;
}

function createAdminFeatureFlagService({
  db,
  audit,
  featureFlags = defaultFeatureFlags,
}) {
  if (!db) {
    throw new Error("db is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }

  async function getAllFeatureFlags() {
    const { DEFAULTS, FLAG_METADATA, getFeatureFlags, clearCache } =
      featureFlags;

    clearCache();

    const flagIds = Object.keys(DEFAULTS);
    const currentValues = await getFeatureFlags(db, flagIds, {
      throwOnError: true,
    });

    const byCategory = {};
    for (const flagId of flagIds) {
      const meta = FLAG_METADATA[flagId] || { category: "other" };
      const category = meta.category || "other";

      if (!byCategory[category]) {
        byCategory[category] = [];
      }

      byCategory[category].push({
        id: flagId,
        value: currentValues[flagId],
        defaultValue: DEFAULTS[flagId],
        ...transformMetadataOptions(meta),
      });
    }

    return { flags: byCategory };
  }

  async function updateFeatureFlags(updates, adminId) {
    const { DEFAULTS, FLAG_METADATA, setFeatureFlag, clearCache } =
      featureFlags;
    const validFlagIds = Object.keys(DEFAULTS);
    const results = [];
    const errors = [];

    for (const [flagId, value] of Object.entries(updates)) {
      if (!validFlagIds.includes(flagId)) {
        errors.push({ flagId, error: `Unknown flag: ${flagId}` });
        continue;
      }

      const validationError = validateFlagValue({
        flagId,
        value,
        meta: FLAG_METADATA[flagId],
      });
      if (validationError) {
        errors.push(validationError);
        continue;
      }

      try {
        await setFeatureFlag(db, flagId, value, adminId);
        results.push({ flagId, value, success: true });
      } catch (err) {
        errors.push({ flagId, error: err.message });
      }
    }

    clearCache();

    await audit(adminId, "admin_update_feature_flags", "feature_flags", "bulk", {
      updated: results.map((result) => result.flagId),
      errors: errors.length > 0 ? errors : undefined,
    });

    return {
      success: errors.length === 0,
      updated: results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  return {
    getAllFeatureFlags,
    updateFeatureFlags,
  };
}

module.exports = {
  createAdminFeatureFlagService,
  validateFlagValue,
};
