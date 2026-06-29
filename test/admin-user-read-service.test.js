process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { AdminService } = require("../src/services/admin-service");
const {
  createAdminUserReadService,
} = require("../src/services/admin/user-read-service");

function createServiceFixture({ repository = {}, attributionService = {} } = {}) {
  const defaults = {
    async searchUsers() {
      return { users: [], total: 0 };
    },
    async getUserStats() {
      return {
        totalUsers: 0,
        paidUsers: 0,
        trialUsers: 0,
        freeUsers: 0,
      };
    },
    async getUserById() {
      return null;
    },
    async getUserVoiceProfile() {
      return null;
    },
    async getUserEntitlements() {
      return null;
    },
    async getLatestUserSubscription() {
      return null;
    },
    async listUserTracks() {
      return [];
    },
    async listUserShares() {
      return [];
    },
    async getLatestUserDownloadAttribution() {
      return null;
    },
    async getLatestResolvedAppleAdsAttribution() {
      return null;
    },
  };

  return createAdminUserReadService({
    adminUserReadRepository: { ...defaults, ...repository },
    attributionService: {
      async attachAttributionToUsers(users) {
        return users;
      },
      async getUserAttribution() {
        return {};
      },
      ...attributionService,
    },
  });
}

describe("AdminUserReadService", () => {
  test("searchUsers delegates bounded filters and attaches attribution", async () => {
    let capturedFilters;
    const service = createServiceFixture({
      repository: {
        async searchUsers(filters) {
          capturedFilters = filters;
          return {
            users: [{ id: "service_user", acquisition_source: "direct" }],
            total: 1,
          };
        },
      },
      attributionService: {
        async attachAttributionToUsers(users) {
          return users.map((user) => ({ ...user, attribution: "attached" }));
        },
      },
    });

    const result = await service.searchUsers({
      email: "owner",
      userId: "service_user",
      riskLevel: "medium",
      tier: "plus",
      trackId: "service_track",
      shareId: "service_share",
      recipientName: "Ada",
      limit: 500,
      offset: -20,
    });

    assert.deepEqual(capturedFilters, {
      email: "owner",
      userId: "service_user",
      riskLevel: "medium",
      tier: "plus",
      trackId: "service_track",
      shareId: "service_share",
      recipientName: "Ada",
      limit: 100,
      offset: 0,
    });
    assert.deepEqual(result, {
      users: [
        {
          id: "service_user",
          acquisition_source: "direct",
          attribution: "attached",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
  });

  test("getUserStats delegates stats reads and preserves conversion formatting", async () => {
    const service = createServiceFixture({
      repository: {
        async getUserStats() {
          return {
            totalUsers: 6,
            paidUsers: 2,
            trialUsers: 1,
            freeUsers: 3,
          };
        },
      },
    });

    assert.deepEqual(await service.getUserStats(), {
      totalUsers: 6,
      paidUsers: 2,
      trialUsers: 1,
      freeUsers: 3,
      conversionRate: "33.3",
    });
  });

  test("getUserStats preserves zero-user conversion formatting", async () => {
    const service = createServiceFixture();

    assert.deepEqual(await service.getUserStats(), {
      totalUsers: 0,
      paidUsers: 0,
      trialUsers: 0,
      freeUsers: 0,
      conversionRate: "0.0",
    });
  });

  test("getUserDetail delegates all reads and merges canonical attribution", async () => {
    const calls = [];
    const service = createServiceFixture({
      repository: {
        async getUserById(userId) {
          calls.push(["getUserById", userId]);
          return { id: userId, acquisition_source: "direct" };
        },
        async getUserVoiceProfile(userId) {
          calls.push(["getUserVoiceProfile", userId]);
          return { id: "voice" };
        },
        async getUserEntitlements(userId) {
          calls.push(["getUserEntitlements", userId]);
          return { tier: "plus" };
        },
        async getLatestUserSubscription(userId) {
          calls.push(["getLatestUserSubscription", userId]);
          return { id: "subscription" };
        },
        async listUserTracks(userId) {
          calls.push(["listUserTracks", userId]);
          return [{ id: "track" }];
        },
        async listUserShares(userId) {
          calls.push(["listUserShares", userId]);
          return [{ id: "share" }];
        },
        async getLatestUserDownloadAttribution(userId) {
          calls.push(["getLatestUserDownloadAttribution", userId]);
          return { id: "download" };
        },
        async getLatestResolvedAppleAdsAttribution(userId) {
          calls.push(["getLatestResolvedAppleAdsAttribution", userId]);
          return { id: "apple" };
        },
      },
      attributionService: {
        async getUserAttribution(user) {
          calls.push(["getUserAttribution", user.id]);
          return { acquisition_source: "seo", acquisition_medium: "landing" };
        },
      },
    });

    const result = await service.getUserDetail("service_detail_user");

    assert.deepEqual(result, {
      user: {
        id: "service_detail_user",
        acquisition_source: "seo",
        acquisition_medium: "landing",
      },
      voiceProfile: { id: "voice" },
      entitlements: { tier: "plus" },
      subscription: { id: "subscription" },
      tracks: [{ id: "track" }],
      shares: [{ id: "share" }],
      attribution: { id: "download" },
      appleAdsAttribution: { id: "apple" },
    });
    assert.deepEqual(calls, [
      ["getUserById", "service_detail_user"],
      ["getUserVoiceProfile", "service_detail_user"],
      ["getUserEntitlements", "service_detail_user"],
      ["getLatestUserSubscription", "service_detail_user"],
      ["listUserTracks", "service_detail_user"],
      ["listUserShares", "service_detail_user"],
      ["getLatestUserDownloadAttribution", "service_detail_user"],
      ["getLatestResolvedAppleAdsAttribution", "service_detail_user"],
      ["getUserAttribution", "service_detail_user"],
    ]);
  });

  test("getUserDetail returns null without fan-out when user is missing", async () => {
    let fanOutCalled = false;
    const service = createServiceFixture({
      repository: {
        async getUserById() {
          return null;
        },
        async getUserVoiceProfile() {
          fanOutCalled = true;
        },
      },
      attributionService: {
        async getUserAttribution() {
          fanOutCalled = true;
        },
      },
    });

    assert.equal(await service.getUserDetail("missing_service_user"), null);
    assert.equal(fanOutCalled, false);
  });
});

describe("AdminService user-read facade", () => {
  test("delegates user-read calls to the injected user-read service", async () => {
    const calls = [];
    const expected = {
      search: { users: [] },
      stats: { totalUsers: 1 },
      detail: { user: { id: "user_1" } },
    };
    const service = new AdminService(
      {},
      {
        adminUserReadService: {
          async searchUsers(payload) {
            calls.push(["searchUsers", payload]);
            return expected.search;
          },
          async getUserStats() {
            calls.push(["getUserStats"]);
            return expected.stats;
          },
          async getUserDetail(userId) {
            calls.push(["getUserDetail", userId]);
            return expected.detail;
          },
        },
      },
    );

    const searchPayload = { email: "owner", limit: 5, offset: 2 };

    assert.deepEqual(await service.searchUsers(searchPayload), expected.search);
    assert.deepEqual(await service.getUserStats(), expected.stats);
    assert.deepEqual(await service.getUserDetail("user_1"), expected.detail);
    assert.deepEqual(calls, [
      ["searchUsers", {
        email: "owner",
        userId: undefined,
        riskLevel: undefined,
        tier: undefined,
        trackId: undefined,
        shareId: undefined,
        recipientName: undefined,
        limit: 5,
        offset: 2,
      }],
      ["getUserStats"],
      ["getUserDetail", "user_1"],
    ]);
  });
});
