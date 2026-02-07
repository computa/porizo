/**
 * Billing API Tests
 *
 * Tests for billing endpoints including receipt validation,
 * subscription status, trial activation, and admin operations.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

describe("Billing API", async () => {
  let db;
  let app;
  let testUserId;
  let adminToken;

  async function loginAdmin() {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "admin123" },
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    return body.token;
  }

  beforeEach(async () => {
    db = await getDatabase();

    // Create test user
    testUserId = `user_billing_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.query(
      "INSERT INTO users (id, created_at) VALUES (?, datetime('now'))",
      [testUserId]
    );

    // Build server with test config
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        // Apple credentials not set - will return 503 for Apple validation
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });

    adminToken = await loginAdmin();
  });

  describe("POST /billing/trial/activate", () => {
    it("activates trial for new user", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        headers: { "x-user-id": testUserId },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.success, true);
      assert.equal(body.trial.songsGranted, 2);
      assert.equal(body.trial.durationDays, 7);
      assert.ok(body.trial.expiresAt);
    });

    it("prevents duplicate trial activation", async () => {
      // Create a separate user for this test to avoid conflicts
      const duplicateTestUserId = `user_duplicate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await db.query(
        "INSERT INTO users (id, created_at) VALUES (?, datetime('now'))",
        [duplicateTestUserId]
      );

      // First activation
      await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        headers: { "x-user-id": duplicateTestUserId },
      });

      // Second activation should fail
      const response = await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        headers: { "x-user-id": duplicateTestUserId },
      });

      assert.equal(response.statusCode, 409);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "TRIAL_ALREADY_USED");
    });

    it("requires authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        // No x-user-id header
      });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("GET /billing/subscription-status", () => {
    it("returns status for user without subscription", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/billing/subscription-status",
        headers: { "x-user-id": testUserId },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.hasActiveSubscription, false);
      assert.equal(body.subscription, null);
    });

    it("returns entitlements after trial activation", async () => {
      // Activate trial first
      await app.inject({
        method: "POST",
        url: "/billing/trial/activate",
        headers: { "x-user-id": testUserId },
      });

      const response = await app.inject({
        method: "GET",
        url: "/billing/subscription-status",
        headers: { "x-user-id": testUserId },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.hasActiveSubscription, false);
      assert.equal(body.entitlements.tier, "free");
      assert.equal(body.entitlements.trialSongsRemaining, 2);
      assert.equal(body.entitlements.songsRemaining, 2);
    });

    it("requires authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/billing/subscription-status",
      });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("POST /billing/receipt/apple", () => {
    it("returns 503 when Apple not configured", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/receipt/apple",
        headers: { "x-user-id": testUserId },
        payload: { transactionId: "test-tx-123" },
      });

      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "APPLE_NOT_CONFIGURED");
    });

    it("requires transactionId", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/receipt/apple",
        headers: { "x-user-id": testUserId },
        payload: {},
      });

      assert.equal(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "MISSING_TRANSACTION_ID");
    });

    it("requires authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/receipt/apple",
        payload: { transactionId: "test-tx-123" },
      });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("POST /billing/receipt/google", () => {
    it("returns 501 not implemented", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/receipt/google",
        headers: { "x-user-id": testUserId },
        payload: { purchaseToken: "test-token" },
      });

      assert.equal(response.statusCode, 501);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "NOT_IMPLEMENTED");
    });
  });

  describe("POST /billing/restore", () => {
    it("requires platform and transactionId", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": testUserId },
        payload: {},
      });

      assert.equal(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "MISSING_PARAMS");
    });

    it("validates platform value", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": testUserId },
        payload: { platform: "invalid", transactionId: "tx-123" },
      });

      assert.equal(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "INVALID_PLATFORM");
    });

    it("returns 503 for apple when not configured", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": testUserId },
        payload: { platform: "apple", transactionId: "tx-123" },
      });

      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "APPLE_NOT_CONFIGURED");
    });

    it("returns 501 for google (not implemented)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": testUserId },
        payload: { platform: "google", transactionId: "tx-123" },
      });

      assert.equal(response.statusCode, 501);
    });

    it("restores Apple subscription when validator and sync succeed", async () => {
      const mockAppleValidator = {
        isConfigured: () => true,
        verifyTransaction: async (transactionId) => ({
          valid: true,
          platform: "apple",
          transactionId,
          productId: "com.porizo.plus_monthly",
        }),
      };

      const mockSubscriptionManager = {
        syncSubscription: async () => ({
          subscriptionId: "sub_restore_1",
          tier: "plus",
          status: "active",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          songsRemaining: 4,
        }),
      };

      const appWithMocks = buildServer({
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
        billingServices: {
          appleValidator: mockAppleValidator,
          subscriptionManager: mockSubscriptionManager,
        },
      });

      try {
        const response = await appWithMocks.inject({
          method: "POST",
          url: "/billing/restore",
          headers: { "x-user-id": testUserId },
          payload: { platform: "apple", transactionId: "tx-success-1" },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.success, true);
        assert.equal(body.restored, true);
        assert.equal(body.subscription.id, "sub_restore_1");
        assert.equal(body.subscription.tier, "plus");
        assert.equal(body.subscription.status, "active");

        const auditRows = await db.query(
          "SELECT action, metadata_json FROM audit_logs WHERE user_id = ? AND action = 'subscription_restored' ORDER BY created_at DESC LIMIT 1",
          [testUserId]
        );
        assert.ok(auditRows.length > 0, "expected subscription_restored audit entry");
        const metadata = JSON.parse(auditRows[0].metadata_json || "{}");
        assert.equal(metadata.platform, "apple");
        assert.equal(metadata.tier, "plus");
      } finally {
        await appWithMocks.close();
      }
    });

    it("returns INVALID_RECEIPT when Apple validation fails", async () => {
      const mockAppleValidator = {
        isConfigured: () => true,
        verifyTransaction: async () => ({
          valid: false,
          error: "transaction_not_found",
        }),
      };

      const mockSubscriptionManager = {
        syncSubscription: async () => {
          throw new Error("syncSubscription should not be called for invalid receipts");
        },
      };

      const appWithMocks = buildServer({
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
        billingServices: {
          appleValidator: mockAppleValidator,
          subscriptionManager: mockSubscriptionManager,
        },
      });

      try {
        const response = await appWithMocks.inject({
          method: "POST",
          url: "/billing/restore",
          headers: { "x-user-id": testUserId },
          payload: { platform: "apple", transactionId: "tx-invalid-1" },
        });

        assert.equal(response.statusCode, 400);
        const body = JSON.parse(response.body);
        assert.equal(body.error, "INVALID_RECEIPT");
      } finally {
        await appWithMocks.close();
      }
    });
  });

  describe("POST /billing/webhooks/apple", () => {
    it("requires signedPayload", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/apple",
        payload: {},
      });

      assert.equal(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "Missing signedPayload");
    });

    it("acknowledges valid-looking payload", async () => {
      // Create a mock JWS (header.payload.signature)
      const header = Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          notificationType: "SUBSCRIBED",
          notificationUUID: "test-uuid",
        })
      ).toString("base64url");
      const signature = Buffer.from("mock-signature").toString("base64url");
      const mockJWS = `${header}.${payload}.${signature}`;

      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/apple",
        payload: { signedPayload: mockJWS },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.received, true);
    });
  });

  describe("POST /billing/webhooks/google", () => {
    it("acknowledges notification (not implemented)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/webhooks/google",
        payload: {},
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.received, true);
    });
  });

  describe("Admin endpoints", () => {
    describe("POST /admin/billing/grant-songs", () => {
      it("requires admin authentication", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/grant-songs",
          payload: { targetUserId: testUserId, amount: 5 },
        });

        assert.equal(response.statusCode, 401);
        const body = JSON.parse(response.body);
        assert.equal(body.error, "UNAUTHORIZED");
      });

      it("grants songs with admin session", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/grant-songs",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
          payload: {
            targetUserId: testUserId,
            amount: 5,
            reason: "Test grant",
          },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.success, true);
        assert.equal(body.songsGranted, 5);
        assert.equal(body.songsRemaining, 5);
      });

      it("validates amount is positive", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/grant-songs",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
          payload: { targetUserId: testUserId, amount: 0 },
        });

        assert.equal(response.statusCode, 400);
        const body = JSON.parse(response.body);
        assert.equal(body.error, "INVALID_PARAMS");
      });
    });

    describe("GET /admin/plans", () => {
      it("requires admin authentication", async () => {
        const response = await app.inject({
          method: "GET",
          url: "/admin/plans",
        });

        assert.equal(response.statusCode, 401);
      });

      it("returns plans and trial config with admin session", async () => {
        const response = await app.inject({
          method: "GET",
          url: "/admin/plans",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.ok(Array.isArray(body.plans));
        assert.ok(body.trialConfig);
        assert.ok(body.plans.length >= 3); // Free, Plus, Pro
      });
    });

    describe("PUT /admin/trial/config", () => {
      it("requires admin authentication", async () => {
        const response = await app.inject({
          method: "PUT",
          url: "/admin/trial/config",
          payload: { songs_allowed: 3 },
        });

        assert.equal(response.statusCode, 401);
      });

      it("updates trial config with admin session", async () => {
        const response = await app.inject({
          method: "PUT",
          url: "/admin/trial/config",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
          payload: {
            songs_allowed: 3,
            duration_days: 14,
          },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.success, true);
        assert.equal(body.trialConfig.songs_allowed, 3);
        assert.equal(body.trialConfig.duration_days, 14);
      });
    });
  });
});
