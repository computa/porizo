process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminEntitlementsService,
} = require("../src/services/admin/entitlements-service");

const NOW = "2026-06-27T10:00:00.000Z";

function createEntitlementsFixture({ repository = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    async upsertTier(userId, tier, nowIso) {
      calls.push(["upsert-tier", userId, tier, nowIso]);
      return { tier: "free" };
    },
  };

  const service = createAdminEntitlementsService({
    adminEntitlementsRepository: { ...defaults, ...repository },
    audit: async (...args) => audits.push(args),
    now: () => new Date(NOW),
  });

  return { audits, calls, service };
}

describe("AdminEntitlementsService", () => {
  test("rejects invalid tiers and empty updates without auditing", async () => {
    const { audits, calls, service } = createEntitlementsFixture();

    assert.deepEqual(
      await service.updateUserEntitlements(
        "user_entitlements",
        { tier: "premium" },
        "admin_ops",
      ),
      {
        success: false,
        error: "tier must be one of: free, trial, pro, plus",
      },
    );
    assert.deepEqual(
      await service.updateUserEntitlements(
        "user_entitlements",
        {},
        "admin_ops",
      ),
      { success: false, error: "No valid fields provided" },
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(audits, []);
  });

  test("updates an existing entitlement tier and audits previous and updated values", async () => {
    const { audits, calls, service } = createEntitlementsFixture();

    assert.deepEqual(
      await service.updateUserEntitlements(
        "user_entitlements",
        { tier: "plus" },
        "admin_ops",
      ),
      { success: true },
    );

    assert.deepEqual(calls, [
      ["upsert-tier", "user_entitlements", "plus", NOW],
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_update_entitlements",
        "user",
        "user_entitlements",
        {
          previous: { tier: "free" },
          updated: { tier: "plus" },
        },
      ],
    ]);
  });

  test("audits the default free previous tier when an entitlement row is inserted", async () => {
    const { audits, service } = createEntitlementsFixture({
      repository: { upsertTier: async () => null },
    });

    assert.deepEqual(
      await service.updateUserEntitlements(
        "user_entitlements",
        { tier: "pro" },
        "admin_ops",
      ),
      { success: true },
    );
    assert.deepEqual(audits[0][4], {
      previous: { tier: "free" },
      updated: { tier: "pro" },
    });
  });
});
