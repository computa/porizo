/**
 * Webhook Security Tests
 *
 * Tests authentication guards on webhook endpoints.
 * Google Play webhook requires GOOGLE_WEBHOOK_SECRET via query param or Bearer token.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

/**
 * Build a base64-encoded Pub/Sub message wrapping a Google subscription notification.
 */
function buildGooglePubSubBody(subscriptionNotification = {}) {
  const innerPayload = {
    subscriptionNotification: {
      purchaseToken: "tok_test_123",
      subscriptionId: "com.porizo.plus_monthly",
      notificationType: 4, // SUBSCRIPTION_PURCHASED
      ...subscriptionNotification,
    },
  };
  return {
    message: {
      data: Buffer.from(JSON.stringify(innerPayload)).toString("base64"),
    },
  };
}

describe("Google Webhook Authentication", async () => {
  let db;
  let app;
  const VALID_SECRET = "whsec_test_google_secret_abc123";
  let savedEnv;

  beforeEach(async () => {
    db = await getDatabase();
    savedEnv = process.env.GOOGLE_WEBHOOK_SECRET;

    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
  });

  afterEach(() => {
    // Restore env to avoid leaking between tests
    if (savedEnv === undefined) {
      delete process.env.GOOGLE_WEBHOOK_SECRET;
    } else {
      process.env.GOOGLE_WEBHOOK_SECRET = savedEnv;
    }
  });

  describe("when GOOGLE_WEBHOOK_SECRET is not configured", () => {
    it("returns 403 WEBHOOK_NOT_CONFIGURED", async () => {
      delete process.env.GOOGLE_WEBHOOK_SECRET;

      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 403);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "WEBHOOK_NOT_CONFIGURED");
    });
  });

  describe("when GOOGLE_WEBHOOK_SECRET is configured", () => {
    beforeEach(() => {
      process.env.GOOGLE_WEBHOOK_SECRET = VALID_SECRET;
    });

    it("rejects request with no token (no query param, no header)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "UNAUTHORIZED");
    });

    it("rejects request with invalid query token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google?token=wrong_token",
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "UNAUTHORIZED");
    });

    it("rejects request with invalid Bearer token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        headers: { authorization: "Bearer wrong_token" },
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "UNAUTHORIZED");
    });

    it("rejects request with empty Authorization header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        headers: { authorization: "" },
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "UNAUTHORIZED");
    });

    it("rejects request with bare 'Bearer ' (no actual token)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        headers: { authorization: "Bearer " },
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "UNAUTHORIZED");
    });

    it("accepts request with valid query token", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/billing/webhooks/google?token=${VALID_SECRET}`,
        payload: buildGooglePubSubBody(),
      });

      // Should pass auth and reach business logic.
      // Without a matching subscription in DB, it returns 200 with deferred:true.
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.received, true);
    });

    it("accepts request with valid Bearer token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        headers: { authorization: `Bearer ${VALID_SECRET}` },
        payload: buildGooglePubSubBody(),
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.received, true);
    });
  });
});
