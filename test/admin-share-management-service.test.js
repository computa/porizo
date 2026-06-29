const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminShareManagementService,
} = require("../src/services/admin/share-management-service");

function createShareManagementFixture({ repository = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    listShares: async (payload) => {
      calls.push({ name: "listShares", payload });
      return [{ id: "share_song" }];
    },
    getShareById: async (shareId) => {
      calls.push({ name: "getShareById", shareId });
      return { id: shareId, bound_device_id: "old-device" };
    },
    rebindShareDevice: async (payload) => {
      calls.push({ name: "rebindShareDevice", payload });
      return { changes: 1 };
    },
    listPoemShares: async (payload) => {
      calls.push({ name: "listPoemShares", payload });
      return [{ id: "poem_share" }];
    },
    getPoemShareById: async (shareId) => {
      calls.push({ name: "getPoemShareById", shareId });
      return { id: shareId, claim_attempts: 4, status: "active" };
    },
    resetPoemShareAttempts: async (shareId) => {
      calls.push({ name: "resetPoemShareAttempts", shareId });
      return { changes: 1 };
    },
    revokePoemShare: async (shareId) => {
      calls.push({ name: "revokePoemShare", shareId });
      return { changes: 1 };
    },
  };

  const service = createAdminShareManagementService({
    adminShareManagementRepository: { ...defaults, ...repository },
    audit: async (...args) => audits.push(args),
  });

  return { audits, calls, service };
}

describe("AdminShareManagementService", () => {
  test("lists song and poem shares with bounded pagination", async () => {
    const { calls, service } = createShareManagementFixture();

    assert.deepEqual(
      await service.listShares({
        status: "active",
        trackId: "track_1",
        userId: "user_1",
        limit: 500,
        offset: -8,
      }),
      [{ id: "share_song" }],
    );
    assert.deepEqual(
      await service.listPoemShares({
        status: "active",
        poemId: "poem_1",
        userId: "user_1",
        limit: "250",
        offset: "-3",
      }),
      [{ id: "poem_share" }],
    );

    assert.deepEqual(calls, [
      {
        name: "listShares",
        payload: {
          status: "active",
          trackId: "track_1",
          userId: "user_1",
          limit: 100,
          offset: 0,
        },
      },
      {
        name: "listPoemShares",
        payload: {
          status: "active",
          poemId: "poem_1",
          userId: "user_1",
          limit: 100,
          offset: 0,
        },
      },
    ]);
  });

  test("rebinds a song share and audits old and new device IDs", async () => {
    const { audits, calls, service } = createShareManagementFixture();

    assert.deepEqual(
      await service.rebindShare(
        "share_song",
        "new-device",
        "admin_ops",
        "support request",
      ),
      {
        success: true,
        oldDeviceId: "old-device",
        newDeviceId: "new-device",
      },
    );
    assert.deepEqual(calls, [
      { name: "getShareById", shareId: "share_song" },
      {
        name: "rebindShareDevice",
        payload: {
          shareId: "share_song",
          newDeviceId: "new-device",
        },
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "share_rebound",
        "share_token",
        "share_song",
        {
          oldDeviceId: "old-device",
          newDeviceId: "new-device",
          reason: "support request",
        },
      ],
    ]);
  });

  test("does not audit missing song shares", async () => {
    const { audits, service } = createShareManagementFixture({
      repository: { getShareById: async () => null },
    });

    assert.deepEqual(
      await service.rebindShare(
        "missing",
        "new-device",
        "admin_ops",
        "support request",
      ),
      { success: false, error: "Share not found" },
    );
    assert.deepEqual(audits, []);
  });

  test("resets poem share attempts and audits previous attempt count", async () => {
    const { audits, calls, service } = createShareManagementFixture();

    assert.deepEqual(
      await service.resetPoemShareAttempts(
        "poem_share",
        "admin_ops",
        "recipient locked out",
      ),
      { success: true, oldAttempts: 4 },
    );
    assert.deepEqual(calls, [
      { name: "getPoemShareById", shareId: "poem_share" },
      { name: "resetPoemShareAttempts", shareId: "poem_share" },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "poem_share_attempts_reset",
        "poem_share_token",
        "poem_share",
        { oldAttempts: 4, reason: "recipient locked out" },
      ],
    ]);
  });

  test("revokes poem shares and audits the old status", async () => {
    const { audits, calls, service } = createShareManagementFixture();

    assert.deepEqual(
      await service.revokePoemShare("poem_share", "admin_ops", "support revoke"),
      { success: true, oldStatus: "active" },
    );
    assert.deepEqual(calls, [
      { name: "getPoemShareById", shareId: "poem_share" },
      { name: "revokePoemShare", shareId: "poem_share" },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "poem_share_revoked",
        "poem_share_token",
        "poem_share",
        { oldStatus: "active", reason: "support revoke" },
      ],
    ]);
  });

  test("does not audit missing or already revoked poem-share mutations", async () => {
    const missing = createShareManagementFixture({
      repository: { getPoemShareById: async () => null },
    });

    assert.deepEqual(
      await missing.service.resetPoemShareAttempts(
        "missing",
        "admin_ops",
        "support request",
      ),
      { success: false, error: "Poem share not found" },
    );
    assert.deepEqual(
      await missing.service.revokePoemShare(
        "missing",
        "admin_ops",
        "support request",
      ),
      { success: false, error: "Poem share not found" },
    );
    assert.deepEqual(missing.audits, []);

    const alreadyRevoked = createShareManagementFixture({
      repository: {
        getPoemShareById: async () => ({
          id: "poem_share",
          claim_attempts: 0,
          status: "revoked",
        }),
      },
    });

    assert.deepEqual(
      await alreadyRevoked.service.revokePoemShare(
        "poem_share",
        "admin_ops",
        "support request",
      ),
      { success: false, error: "Already revoked" },
    );
    assert.deepEqual(alreadyRevoked.audits, []);
  });
});
