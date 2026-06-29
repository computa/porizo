const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminSecurityObservabilityService,
  escapeLikePattern,
} = require("../src/services/admin/security-observability-service");

const FIXED_NOW = "2026-06-29T12:00:00.000Z";

function createSecurityObservabilityFixture({ repository = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    searchAuthEvents: async (payload) => {
      calls.push({ name: "searchAuthEvents", payload });
      return [{ id: "auth_event" }];
    },
    getAuthEventStats: async (payload) => {
      calls.push({ name: "getAuthEventStats", payload });
      return [
        { event_type: "login_success", count: 3 },
        { event_type: "login_failed", count: 2 },
      ];
    },
    getAppleRefreshTokenStats: async (payload) => {
      calls.push({ name: "getAppleRefreshTokenStats", payload });
      return [
        {
          action: "apple_refresh_token_validated",
          count: 4,
          last_seen: "2026-06-29T10:00:00.000Z",
        },
      ];
    },
    searchAuditLogs: async (payload) => {
      calls.push({ name: "searchAuditLogs", payload });
      return [{ id: "audit_log" }];
    },
    getRateLimits: async (payload) => {
      calls.push({ name: "getRateLimits", payload });
      return [{ user_id: "user_rate" }];
    },
    deleteRateLimitRows: async (userId, actionType) => {
      calls.push({ name: "deleteRateLimitRows", userId, actionType });
      return { changes: 1 };
    },
    getConsentLogs: async (payload) => {
      calls.push({ name: "getConsentLogs", payload });
      return [{ id: "voice_profile" }];
    },
  };

  const service = createAdminSecurityObservabilityService({
    adminSecurityObservabilityRepository: { ...defaults, ...repository },
    audit: async (...args) => audits.push(args),
    now: () => new Date(FIXED_NOW),
  });

  return { audits, calls, service };
}

describe("AdminSecurityObservabilityService", () => {
  test("escapes SQL LIKE wildcard characters", () => {
    assert.equal(escapeLikePattern("admin_%\\literal"), "admin\\_\\%\\\\literal");
  });

  test("searches auth events with bounded pagination and filters", async () => {
    const { calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(
      await service.searchAuthEvents({
        eventType: "login_failed",
        userId: "user_auth",
        startDate: "2026-06-28T00:00:00.000Z",
        endDate: "2026-06-29T00:00:00.000Z",
        limit: 500,
        offset: -1,
      }),
      [{ id: "auth_event" }],
    );
    assert.deepEqual(calls, [
      {
        name: "searchAuthEvents",
        payload: {
          filters: {
            eventType: "login_failed",
            userId: "user_auth",
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-06-29T00:00:00.000Z",
          },
          limit: 100,
          offset: 0,
        },
      },
    ]);
  });

  test("normalizes auth event stats from a 24 hour window", async () => {
    const { calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(await service.getAuthEventStats(), {
      byType: [
        { event_type: "login_success", count: 3 },
        { event_type: "login_failed", count: 2 },
      ],
      loginSuccess: 3,
      loginFailed: 2,
    });
    assert.deepEqual(calls, [
      {
        name: "getAuthEventStats",
        payload: { since: "2026-06-28T12:00:00.000Z" },
      },
    ]);
  });

  test("normalizes Apple refresh-token stats from the requested day window", async () => {
    const { calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(await service.getAppleRefreshTokenStats(3), {
      validated: 4,
      invalid: 0,
      lastValidated: "2026-06-29T10:00:00.000Z",
      lastInvalid: null,
      byAction: [
        {
          action: "apple_refresh_token_validated",
          count: 4,
          last_seen: "2026-06-29T10:00:00.000Z",
        },
      ],
    });
    assert.deepEqual(calls, [
      {
        name: "getAppleRefreshTokenStats",
        payload: { startDate: "2026-06-26T12:00:00.000Z" },
      },
    ]);
  });

  test("searches audit logs with escaped action pattern and bounded pagination", async () => {
    const { calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(
      await service.searchAuditLogs({
        action: "admin_%literal",
        resourceType: "user",
        startDate: "2026-06-28T00:00:00.000Z",
        endDate: "2026-06-29T00:00:00.000Z",
        limit: 250,
        offset: -2,
      }),
      [{ id: "audit_log" }],
    );
    assert.deepEqual(calls, [
      {
        name: "searchAuditLogs",
        payload: {
          filters: {
            actionPattern: "%admin\\_\\%literal%",
            resourceType: "user",
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-06-29T00:00:00.000Z",
          },
          limit: 100,
          offset: 0,
        },
      },
    ]);
  });

  test("gets rate limits with bounded pagination and a 24 hour window", async () => {
    const { calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(
      await service.getRateLimits({
        userId: "user_rate",
        actionType: "share_create",
        nearLimit: true,
        limit: 500,
        offset: -10,
      }),
      [{ user_id: "user_rate" }],
    );
    assert.deepEqual(calls, [
      {
        name: "getRateLimits",
        payload: {
          filters: {
            userId: "user_rate",
            actionType: "share_create",
            nearLimit: true,
            windowStartAfterMs: new Date(FIXED_NOW).getTime() - 86400000,
          },
          limit: 100,
          offset: 0,
        },
      },
    ]);
  });

  test("resets rate limit rows and audits the admin action", async () => {
    const { audits, calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(
      await service.resetUserRateLimit(
        "user_rate",
        "share_create",
        "admin_ops",
        "support reset",
      ),
      { success: true },
    );
    assert.deepEqual(calls, [
      {
        name: "deleteRateLimitRows",
        userId: "user_rate",
        actionType: "share_create",
      },
    ]);
    assert.deepEqual(audits, [
      [
        "admin_ops",
        "admin_reset_rate_limit",
        "user",
        "user_rate",
        { actionType: "share_create", reason: "support reset" },
      ],
    ]);
  });

  test("gets consent logs with bounded pagination and filters", async () => {
    const { calls, service } = createSecurityObservabilityFixture();

    assert.deepEqual(
      await service.getConsentLogs({
        consentVersion: "v2",
        startDate: "2026-06-28T00:00:00.000Z",
        endDate: "2026-06-29T00:00:00.000Z",
        limit: 500,
        offset: -5,
      }),
      [{ id: "voice_profile" }],
    );
    assert.deepEqual(calls, [
      {
        name: "getConsentLogs",
        payload: {
          filters: {
            consentVersion: "v2",
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-06-29T00:00:00.000Z",
          },
          limit: 100,
          offset: 0,
        },
      },
    ]);
  });
});
