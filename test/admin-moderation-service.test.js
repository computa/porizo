const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminModerationService,
} = require("../src/services/admin/moderation-service");

function createModerationFixture({ approveResult = { status: "approved" } } = {}) {
  const audits = [];
  const calls = [];
  const service = createAdminModerationService({
    adminModerationRepository: {
      listBlockedVersions: async (bounds) => {
        calls.push({ name: "listBlockedVersions", bounds });
        return [{ id: "version_blocked" }];
      },
      approveBlockedVersion: async (payload) => {
        calls.push({ name: "approveBlockedVersion", payload });
        return approveResult;
      },
    },
    audit: async (...args) => audits.push(args),
  });

  return { audits, calls, service };
}

describe("AdminModerationService", () => {
  test("lists moderation queue with bounded pagination", async () => {
    const { calls, service } = createModerationFixture();

    assert.deepEqual(
      await service.getModerationQueue({ limit: 500, offset: -10 }),
      [{ id: "version_blocked" }],
    );
    assert.deepEqual(calls, [
      {
        name: "listBlockedVersions",
        bounds: { limit: 100, offset: 0 },
      },
    ]);
  });

  test("audits only successful moderation overrides", async () => {
    const { audits, calls, service } = createModerationFixture();

    assert.deepEqual(
      await service.overrideModeration(
        "version_blocked",
        "admin_moderator",
        "manual review passed",
      ),
      { success: true },
    );

    assert.deepEqual(calls, [
      {
        name: "approveBlockedVersion",
        payload: {
          versionId: "version_blocked",
          reason: "manual review passed",
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_moderator",
        "admin_moderation_override",
        "track_version",
        "version_blocked",
        { reason: "manual review passed" },
      ],
    ]);
  });

  test("returns missing-version result without auditing", async () => {
    const { audits, service } = createModerationFixture({
      approveResult: { status: "not_found" },
    });

    assert.deepEqual(
      await service.overrideModeration(
        "missing_version",
        "admin_moderator",
        "manual review passed",
      ),
      { success: false, error: "Track version not found" },
    );
    assert.deepEqual(audits, []);
  });

  test("returns non-blocked result and moderation status without auditing", async () => {
    const { audits, service } = createModerationFixture({
      approveResult: { status: "not_blocked", moderationStatus: "approved" },
    });

    assert.deepEqual(
      await service.overrideModeration(
        "version_approved",
        "admin_moderator",
        "manual review passed",
      ),
      {
        success: false,
        error: "Track version is not blocked",
        moderationStatus: "approved",
      },
    );
    assert.deepEqual(audits, []);
  });
});
