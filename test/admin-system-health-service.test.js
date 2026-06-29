process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminSystemHealthService,
} = require("../src/services/admin/system-health-service");

describe("AdminSystemHealthService", () => {
  test("owns system-health windows, default counters, and checked timestamp", async () => {
    const calls = [];
    const service = createAdminSystemHealthService({
      now: () => new Date("2026-06-29T12:00:00.000Z"),
      adminJobOpsRepository: {
        async getSystemHealth(args) {
          calls.push(args);
          return {
            jobs: { running: 2 },
            dlqCount: 3,
            recentErrors: [{ id: "job_error" }],
          };
        },
      },
    });

    assert.deepEqual(await service.getSystemHealth(), {
      jobs: { running: 2, queued: 0, failed: 0 },
      dlqCount: 3,
      recentErrors: [{ id: "job_error" }],
      checkedAt: "2026-06-29T12:00:00.000Z",
    });
    assert.deepEqual(calls, [{ since: "2026-06-28T12:00:00.000Z" }]);
  });
});
