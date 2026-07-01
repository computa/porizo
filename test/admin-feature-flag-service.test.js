const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminFeatureFlagService,
} = require("../src/services/admin/feature-flag-service");

function createFeatureFlagsFixture() {
  const calls = [];
  const values = {
    show_design_screens: false,
    timbre_blend_strategy: "amplitude",
    seedvc_cfg_rate: 0.65,
  };
  const featureFlags = {
    DEFAULTS: {
      show_design_screens: false,
      timbre_blend_strategy: "amplitude",
      seedvc_cfg_rate: 0.65,
    },
    FLAG_METADATA: {
      show_design_screens: {
        category: "developer",
        label: "Show Design Screens",
        type: "boolean",
      },
      timbre_blend_strategy: {
        category: "voice_conversion",
        label: "Timbre Blend Strategy",
        options: ["amplitude", { value: "spectral", label: "Spectral" }],
      },
      seedvc_cfg_rate: {
        category: "voice_conversion",
        label: "CFG Rate",
        type: "number",
        min: 0.1,
        max: 1,
      },
    },
    clearCache: () => {
      calls.push({ name: "clearCache" });
    },
    getFeatureFlags: async (db, flagIds, options) => {
      calls.push({ name: "getFeatureFlags", db, flagIds, options });
      return Object.fromEntries(flagIds.map((flagId) => [flagId, values[flagId]]));
    },
    setFeatureFlag: async (db, flagId, value, adminId) => {
      calls.push({ name: "setFeatureFlag", db, flagId, value, adminId });
      values[flagId] = value;
    },
  };
  return { calls, featureFlags, values };
}

describe("AdminFeatureFlagService", () => {
  test("groups flags by metadata category and transforms string options", async () => {
    const { calls, featureFlags } = createFeatureFlagsFixture();
    const service = createAdminFeatureFlagService({
      db: { id: "db" },
      audit: async () => {},
      featureFlags,
    });

    const result = await service.getAllFeatureFlags();

    assert.equal(calls[0].name, "clearCache");
    assert.equal(calls[1].name, "getFeatureFlags");
    assert.deepEqual(calls[1].flagIds, Object.keys(featureFlags.DEFAULTS));
    assert.deepEqual(calls[1].options, { throwOnError: true });

    const developerFlag = result.flags.developer.find(
      (flag) => flag.id === "show_design_screens",
    );
    assert.equal(developerFlag.value, false);
    assert.equal(developerFlag.defaultValue, false);
    assert.equal(developerFlag.type, "boolean");

    const strategy = result.flags.voice_conversion.find(
      (flag) => flag.id === "timbre_blend_strategy",
    );
    assert.deepEqual(strategy.options, [
      { value: "amplitude", label: "amplitude" },
      { value: "spectral", label: "Spectral" },
    ]);
  });

  test("updates valid flags, preserves partial errors, clears cache, and audits", async () => {
    const { calls, featureFlags, values } = createFeatureFlagsFixture();
    const audits = [];
    const service = createAdminFeatureFlagService({
      db: { id: "db" },
      audit: async (...args) => audits.push(args),
      featureFlags,
    });

    const result = await service.updateFeatureFlags(
      {
        show_design_screens: true,
        seedvc_cfg_rate: "0.7",
        unknown_feature_flag: true,
        bad_boolean: "true",
      },
      "admin_1",
    );

    assert.deepEqual(result, {
      success: false,
      updated: [
        { flagId: "show_design_screens", value: true, success: true },
        { flagId: "seedvc_cfg_rate", value: "0.7", success: true },
      ],
      errors: [
        {
          flagId: "unknown_feature_flag",
          error: "Unknown flag: unknown_feature_flag",
        },
        { flagId: "bad_boolean", error: "Unknown flag: bad_boolean" },
      ],
    });
    assert.equal(values.show_design_screens, true);
    assert.equal(values.seedvc_cfg_rate, "0.7");
    assert.deepEqual(
      calls
        .filter((call) => call.name === "setFeatureFlag")
        .map(({ flagId, value, adminId }) => ({ flagId, value, adminId })),
      [
        { flagId: "show_design_screens", value: true, adminId: "admin_1" },
        { flagId: "seedvc_cfg_rate", value: "0.7", adminId: "admin_1" },
      ],
    );
    assert.equal(calls.at(-1).name, "clearCache");
    assert.deepEqual(audits[0], [
      "admin_1",
      "admin_update_feature_flags",
      "feature_flags",
      "bulk",
      {
        updated: ["show_design_screens", "seedvc_cfg_rate"],
        errors: result.errors,
      },
    ]);
  });

  test("validates boolean and number metadata without throwing", async () => {
    const { featureFlags } = createFeatureFlagsFixture();
    const service = createAdminFeatureFlagService({
      db: { id: "db" },
      audit: async () => {},
      featureFlags,
    });

    const result = await service.updateFeatureFlags(
      {
        show_design_screens: "true",
        seedvc_cfg_rate: 2,
      },
      "admin_2",
    );

    assert.deepEqual(result, {
      success: false,
      updated: [],
      errors: [
        { flagId: "show_design_screens", error: "Value must be a boolean" },
        { flagId: "seedvc_cfg_rate", error: "Value must be <= 1" },
      ],
    });
  });
});
