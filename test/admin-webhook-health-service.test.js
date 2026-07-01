process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminWebhookHealthService,
} = require("../src/services/admin/webhook-health-service");

describe("AdminWebhookHealthService", () => {
  test("owns the webhook health time window and pending retry placeholder", async () => {
    const calls = [];
    const service = createAdminWebhookHealthService({
      now: () => new Date("2026-06-29T12:00:00.000Z"),
      adminBillingRepository: {
        async getWebhookHealth(args) {
          calls.push(args);
          return {
            lastWebhookReceived: "2026-06-29T11:00:00.000Z",
            failedWebhooks: 2,
            webhooksByType: [{ webhook_type: "webhook_apple_processed", count: 3 }],
          };
        },
      },
    });

    assert.deepEqual(await service.getWebhookHealth(), {
      lastWebhookReceived: "2026-06-29T11:00:00.000Z",
      failedWebhooks: 2,
      webhooksByType: [{ webhook_type: "webhook_apple_processed", count: 3 }],
      pendingRetries: 0,
    });
    assert.deepEqual(calls, [{ since: "2026-06-28T12:00:00.000Z" }]);
  });
});
