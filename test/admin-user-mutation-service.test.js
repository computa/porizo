process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  EMPTY_ATTRIBUTION,
  createAdminUserMutationService,
} = require("../src/services/admin/user-mutation-service");

const NOW = "2026-06-27T10:00:00.000Z";
const LOCKED_UNTIL = "2027-06-27T10:00:00.000Z";

function createMutationFixture({ repository = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    async updateRiskLevel(userId, riskLevel) {
      calls.push(["update-risk", userId, riskLevel]);
      return { changes: 1 };
    },
    async updateLockedUntil(userId, lockedUntil) {
      calls.push(["update-lock", userId, lockedUntil]);
      return { changes: 1 };
    },
    async findDeletionSnapshot(userId) {
      calls.push(["find-delete", userId]);
      return {
        id: userId,
        email: `${userId}@example.com`,
        display_name: "Delete Me",
      };
    },
    async deleteUser(userId) {
      calls.push(["delete-user", userId]);
      return { changes: 1 };
    },
    async getAttributionSnapshot(userId) {
      calls.push(["get-attribution", userId]);
      return {
        acquisition_source: "old-source",
        acquisition_medium: "old-medium",
        acquisition_campaign: "old-campaign",
        acquisition_content: null,
        acquisition_term: null,
        acquisition_country: "AU",
        acquisition_referrer: null,
        acquisition_at: "2026-06-01T00:00:00.000Z",
      };
    },
    async updateUserFields(userId, updates) {
      calls.push(["update-fields", userId, updates]);
      return { changes: 1 };
    },
  };

  const service = createAdminUserMutationService({
    adminUserMutationRepository: { ...defaults, ...repository },
    audit: async (...args) => audits.push(args),
    now: () => new Date(NOW),
  });

  return { audits, calls, service };
}

describe("AdminUserMutationService", () => {
  test("updates risk level and writes the existing audit contract", async () => {
    const { audits, calls, service } = createMutationFixture();

    assert.deepEqual(
      await service.updateUserRisk(
        "user_risk",
        "high",
        "admin_ops",
        "chargeback pattern",
      ),
      { success: true },
    );
    assert.deepEqual(calls, [["update-risk", "user_risk", "high"]]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_update_risk",
        "user",
        "user_risk",
        { riskLevel: "high", reason: "chargeback pattern" },
      ],
    ]);
  });

  test("locks and unlocks users with the fixed one-year lock policy", async () => {
    const { audits, calls, service } = createMutationFixture();

    assert.deepEqual(
      await service.lockUser("user_lock", true, "admin_ops", "manual review"),
      { success: true, lockedUntil: LOCKED_UNTIL },
    );
    assert.deepEqual(
      await service.lockUser("user_lock", false, "admin_ops", "cleared"),
      { success: true, lockedUntil: null },
    );
    assert.deepEqual(calls, [
      ["update-lock", "user_lock", LOCKED_UNTIL],
      ["update-lock", "user_lock", null],
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_lock_user",
        "user",
        "user_lock",
        { reason: "manual review" },
      ],
      [
        "admin_ops",
        "admin_unlock_user",
        "user",
        "user_lock",
        { reason: "cleared" },
      ],
    ]);
  });

  test("deleteUser audits the deletion snapshot before deleting", async () => {
    const { audits, calls, service } = createMutationFixture();

    assert.deepEqual(
      await service.deleteUser(
        "user_delete",
        "admin_ops",
        "user requested admin purge",
      ),
      {
        success: true,
        deleted: {
          id: "user_delete",
          email: "user_delete@example.com",
          displayName: "Delete Me",
        },
      },
    );
    assert.deepEqual(calls, [
      ["find-delete", "user_delete"],
      ["delete-user", "user_delete"],
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_delete_user",
        "user",
        "user_delete",
        {
          reason: "user requested admin purge",
          deleted_email: "user_delete@example.com",
          deleted_display_name: "Delete Me",
        },
      ],
    ]);
  });

  test("deleteUser does not audit missing users", async () => {
    const { audits, calls, service } = createMutationFixture({
      repository: { findDeletionSnapshot: async () => null },
    });

    assert.deepEqual(
      await service.deleteUser("missing_user", "admin_ops", "not found"),
      { success: false, error: "User not found" },
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(audits, []);
  });

  test("bulkUserAction validates payloads and records summary audit after per-user mutations", async () => {
    const { audits, calls, service } = createMutationFixture({
      repository: {
        async updateLockedUntil(userId, lockedUntil) {
          calls.push(["update-lock", userId, lockedUntil]);
          if (userId === "user_fail") {
            throw new Error("lock failed");
          }
          return { changes: 1 };
        },
      },
    });

    assert.deepEqual(await service.bulkUserAction(["u1"], "suspend", "admin_ops", ""), {
      succeeded: [],
      failed: [{ userId: null, error: "Invalid action: suspend" }],
    });
    assert.deepEqual(await service.bulkUserAction([], "lock", "admin_ops", ""), {
      succeeded: [],
      failed: [{ userId: null, error: "userIds must be an array of 1-50 IDs" }],
    });

    assert.deepEqual(
      await service.bulkUserAction(
        ["user_ok", "user_fail"],
        "lock",
        "admin_ops",
        "bulk risk review",
      ),
      {
        succeeded: ["user_ok"],
        failed: [{ userId: "user_fail", error: "lock failed" }],
      },
    );

    assert.deepEqual(calls, [
      ["update-lock", "user_ok", LOCKED_UNTIL],
      ["update-lock", "user_fail", LOCKED_UNTIL],
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_lock_user",
        "user",
        "user_ok",
        { reason: "bulk risk review" },
      ],
      [
        "admin_ops",
        "admin_bulk_lock",
        "user",
        "bulk",
        {
          action: "lock",
          requestedCount: 2,
          succeededCount: 1,
          failedCount: 1,
          reason: "bulk risk review",
        },
      ],
    ]);
  });

  test("updateUserProfile filters fields and audits attribution before and after snapshots", async () => {
    const { audits, calls, service } = createMutationFixture({
      repository: {
        async getAttributionSnapshot(userId) {
          calls.push(["get-attribution", userId]);
          return calls.filter(([name]) => name === "get-attribution").length === 1
            ? {
                acquisition_source: "old-source",
                acquisition_medium: "old-medium",
                acquisition_campaign: "old-campaign",
                acquisition_content: null,
                acquisition_term: null,
                acquisition_country: "AU",
                acquisition_referrer: null,
                acquisition_at: "2026-06-01T00:00:00.000Z",
              }
            : {
                acquisition_source: "Founder outreach",
                acquisition_medium: "email",
                acquisition_campaign: "friends_test",
                acquisition_content: null,
                acquisition_term: null,
                acquisition_country: "AU",
                acquisition_referrer: null,
                acquisition_at: "2026-06-01T00:00:00.000Z",
              };
        },
      },
    });

    assert.deepEqual(
      await service.updateUserProfile(
        "user_profile",
        { ignored_field: "ignored" },
        "admin_ops",
      ),
      { success: false, error: "No valid fields provided" },
    );

    const result = await service.updateUserProfile(
      "user_profile",
      {
        display_name: "New Profile",
        email: "new-profile@example.com",
        acquisition_source: "Founder outreach",
        acquisition_medium: "email",
        acquisition_campaign: "friends_test",
        ignored_field: "ignored",
      },
      "admin_ops",
    );

    assert.deepEqual(result, {
      success: true,
      updated: {
        display_name: "New Profile",
        email: "new-profile@example.com",
        acquisition_source: "Founder outreach",
        acquisition_medium: "email",
        acquisition_campaign: "friends_test",
      },
    });
    assert.deepEqual(calls, [
      ["get-attribution", "user_profile"],
      [
        "update-fields",
        "user_profile",
        {
          display_name: "New Profile",
          email: "new-profile@example.com",
          acquisition_source: "Founder outreach",
          acquisition_medium: "email",
          acquisition_campaign: "friends_test",
        },
      ],
      ["get-attribution", "user_profile"],
    ]);
    assert.deepEqual(audits.map((audit) => audit[1]), [
      "admin_update_user_profile",
      "admin_update_user_attribution",
    ]);
    assert.deepEqual(audits[0][4].changedFields, result.updated);
    assert.equal(
      audits[1][4].contract,
      "attribution-source-precedence-v1",
    );
    assert.equal(audits[1][4].previous.acquisition_source, "old-source");
    assert.equal(audits[1][4].next.acquisition_source, "Founder outreach");
    assert.deepEqual(audits[1][4].changedFields, {
      acquisition_source: "Founder outreach",
      acquisition_medium: "email",
      acquisition_campaign: "friends_test",
    });
  });

  test("updateUserProfile uses the empty attribution envelope for missing snapshots", async () => {
    const { audits, service } = createMutationFixture({
      repository: { getAttributionSnapshot: async () => null },
    });

    assert.deepEqual(
      await service.updateUserProfile(
        "missing_user",
        { acquisition_source: "manual" },
        "admin_ops",
      ),
      { success: true, updated: { acquisition_source: "manual" } },
    );
    assert.deepEqual(audits[1][4].previous, EMPTY_ATTRIBUTION);
    assert.deepEqual(audits[1][4].next, EMPTY_ATTRIBUTION);
  });
});
