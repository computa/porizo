process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { AdminService } = require("../src/services/admin-service");
const {
  createAdminAnalyticsService,
} = require("../src/services/admin/analytics-service");

const NOW = "2026-06-27T10:00:00.000Z";
const DAY_AGO = "2026-06-26T10:00:00.000Z";
const WEEK_AGO = "2026-06-20T10:00:00.000Z";
const YEAR_AGO = "2025-06-27T10:00:00.000Z";

function createAnalyticsFixture(repository = {}) {
  const calls = [];
  const defaults = {
    async getAdminEventCountsAfter(startDate) {
      calls.push(["overview", startDate]);
      return [{ event_name: "auth_completed", count: 2 }];
    },
    async getAdminDailyEventCountsAfter(eventName, startDate) {
      calls.push(["daily", eventName, startDate]);
      return [{ date: "2026-06-25", count: 2 }];
    },
    async countDistinctUsersForEventAfter(eventName, startDate) {
      calls.push(["funnel-start", eventName, startDate]);
      return { c: eventName === "first_song_completed" ? 1 : 2 };
    },
    async countDistinctUsersConvertedAfter(startEvent, endEvent, startDate) {
      calls.push(["funnel-converted", startEvent, endEvent, startDate]);
      return { c: startEvent === "create_started" ? 1 : 2 };
    },
    async getAdminUserEvents(userId, limit) {
      calls.push(["user-events", userId, limit]);
      return [
        {
          id: "evt_admin_boundary",
          event_name: "auth_completed",
          user_id: userId,
          resource_type: "track",
          resource_id: "track_1",
          metadata_json: "{}",
          created_at: "2026-06-25T12:00:00.000Z",
        },
      ];
    },
    async insertUserAnalyticsReadAudit(payload) {
      calls.push(["audit", payload]);
    },
  };

  const service = createAdminAnalyticsService({
    eventsRepository: { ...defaults, ...repository },
    now: () => new Date(NOW),
    random: () => 0.123456789,
  });

  return { calls, service };
}

describe("AdminAnalyticsService", () => {
  test("delegates analytics reads, clamps inputs, and caches aggregate payloads", async () => {
    const { calls, service } = createAnalyticsFixture();

    const overview = await service.getAnalyticsOverview(0);
    assert.deepEqual(overview, {
      days: 1,
      counts: [{ event_name: "auth_completed", count: 2 }],
    });

    const cachedOverview = await service.getAnalyticsOverview(0);
    assert.deepEqual(cachedOverview, overview);
    assert.equal(calls.filter(([name]) => name === "overview").length, 1);
    assert.deepEqual(calls.find(([name]) => name === "overview"), [
      "overview",
      DAY_AGO,
    ]);

    const daily = await service.getAnalyticsDaily("auth_completed", 500);
    assert.deepEqual(daily, {
      event_name: "auth_completed",
      days: 365,
      byDay: [{ date: "2026-06-25", count: 2 }],
    });
    assert.deepEqual(calls.find(([name]) => name === "daily"), [
      "daily",
      "auth_completed",
      YEAR_AGO,
    ]);

    const funnel = await service.getFunnelCohort(7);
    assert.equal(funnel.days, 7);
    assert.equal(funnel.steps.length, 4);
    assert.deepEqual(funnel.steps[1], {
      from: "create_started",
      to: "create_completed",
      startUsers: 2,
      convertedUsers: 1,
      conversionRate: "50.00",
    });
    assert.ok(
      calls
        .filter(([name]) => name === "funnel-start")
        .every(([, , startDate]) => startDate === WEEK_AGO),
    );
  });

  test("getUserAnalytics clamps limit and writes an audit row", async () => {
    const { calls, service } = createAnalyticsFixture();

    const userAnalytics = await service.getUserAnalytics(
      "admin_1",
      "admin@porizo.app",
      "user_1",
      999,
    );

    assert.equal(userAnalytics.userId, "user_1");
    assert.equal(userAnalytics.limit, 200);
    assert.equal(userAnalytics.events[0].id, "evt_admin_boundary");
    assert.deepEqual(calls.find(([name]) => name === "user-events"), [
      "user-events",
      "user_1",
      200,
    ]);

    const auditCall = calls.find(([name]) => name === "audit");
    assert.ok(auditCall, "expected analytics read audit call");
    assert.match(auditCall[1].id, /^audit_[a-z0-9]+_[a-z0-9]+$/);
    assert.equal(auditCall[1].adminId, "admin_1");
    assert.equal(auditCall[1].targetUserId, "user_1");
    assert.equal(auditCall[1].createdAt, NOW);
    assert.deepEqual(JSON.parse(auditCall[1].metadataJson), {
      admin_id: "admin_1",
      admin_email: "admin@porizo.app",
      target_user_id: "user_1",
      event_count: 1,
    });
  });
});

describe("AdminService analytics facade", () => {
  test("delegates analytics methods to the injected analytics service", async () => {
    const calls = [];
    const expected = {
      overview: { days: 7 },
      daily: { event_name: "auth_completed" },
      funnel: { steps: [] },
      user: { userId: "user_1" },
    };
    const service = new AdminService(
      {},
      {
        adminAnalyticsService: {
          async getAnalyticsOverview(days) {
            calls.push(["overview", days]);
            return expected.overview;
          },
          async getAnalyticsDaily(eventName, days) {
            calls.push(["daily", eventName, days]);
            return expected.daily;
          },
          async getFunnelCohort(days) {
            calls.push(["funnel", days]);
            return expected.funnel;
          },
          async getUserAnalytics(adminId, adminEmail, userId, limit) {
            calls.push(["user", adminId, adminEmail, userId, limit]);
            return expected.user;
          },
        },
      },
    );

    assert.deepEqual(await service.getAnalyticsOverview(7), expected.overview);
    assert.deepEqual(
      await service.getAnalyticsDaily("auth_completed", 30),
      expected.daily,
    );
    assert.deepEqual(await service.getFunnelCohort(14), expected.funnel);
    assert.deepEqual(
      await service.getUserAnalytics("admin_1", "admin@porizo.app", "user_1", 9),
      expected.user,
    );
    assert.deepEqual(calls, [
      ["overview", 7],
      ["daily", "auth_completed", 30],
      ["funnel", 14],
      ["user", "admin_1", "admin@porizo.app", "user_1", 9],
    ]);
  });
});
