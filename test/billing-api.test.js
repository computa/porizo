/**
 * Billing API Tests
 *
 * Tests for billing endpoints including receipt validation,
 * subscription status, trial activation, and admin operations.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const { buildEntitlementsPayload } = require("../src/routes/billing");

describe("Billing API", async () => {
  let db;
  let app;
  let testUserId;
  let adminToken;

  async function loginAdmin(appInstance = app) {
    const response = await appInstance.inject({
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
      [testUserId],
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
        [duplicateTestUserId],
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

  describe("GET /billing/plans", () => {
    it("returns plans with App Store product ID mappings", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/billing/plans",
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.plans));
      assert.ok(body.plans.length > 0);

      const plusPlan = body.plans.find((plan) => plan.tier === "plus");
      assert.ok(plusPlan);
      assert.equal(plusPlan.songs_per_month, 10);
      assert.equal(plusPlan.poems_per_month, 10);
      assert.equal(
        plusPlan.apple_product_ids.monthly,
        "com.porizo.plus_monthly",
      );
      assert.equal(plusPlan.apple_product_ids.annual, "com.porizo.plus_annual");
      assert.equal(Object.hasOwn(plusPlan, "previews_per_day"), false);
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
      assert.equal(body.entitlements.baseSongsRemaining, 1);
      assert.equal(body.entitlements.trialSongsRemaining, 2);
      assert.equal(body.entitlements.songsRemaining, 3);
    });

    it("requires authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/billing/subscription-status",
      });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("GET /billing/subscription (compat alias)", () => {
    it("returns status payload from compatibility endpoint", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/billing/subscription",
        headers: { "x-user-id": testUserId },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.hasActiveSubscription, false);
      assert.equal(body.has_subscription, false);
      assert.equal(body.subscription, null);
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

    it("accepts legacy transaction_id field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/receipt/apple",
        headers: { "x-user-id": testUserId },
        payload: { transaction_id: "test-tx-legacy-123" },
      });

      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "APPLE_NOT_CONFIGURED");
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

  describe("POST /billing/receipt/apple/consumable", () => {
    it("maps Apple auth failures to a retryable 503", async () => {
      const authError = new Error("App Store API error: 401");
      authError.status = 401;
      authError.data = { message: "" };
      const mockAppleValidator = {
        isConfigured: () => true,
        verifyTransaction: async () => {
          throw authError;
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
        },
      });

      const response = await appWithMocks.inject({
        method: "POST",
        url: "/billing/receipt/apple/consumable",
        headers: { "x-user-id": testUserId },
        payload: { transactionId: "gift_tx_auth_401" },
      });

      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "APPLE_VALIDATION_AUTH_FAILED");
    });

    it("rolls back inserted receipt when wallet credit step fails", async () => {
      const mockAppleValidator = {
        isConfigured: () => true,
        verifyTransaction: async (transactionId) => ({
          valid: true,
          type: "one_time_purchase",
          transactionId,
          originalTransactionId: transactionId,
          productId: "com.porizo.gift_token_oneoff",
          purchaseDate: new Date(),
          environment: "sandbox",
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
        },
      });

      // Force wallet write path to fail after receipt insert.
      await db.query("DROP TABLE gift_wallet");

      const transactionId = "gift_tx_wallet_fail_1";
      const response = await appWithMocks.inject({
        method: "POST",
        url: "/billing/receipt/apple/consumable",
        headers: { "x-user-id": testUserId },
        payload: { transactionId },
      });

      assert.equal(response.statusCode, 500);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "GIFT_PURCHASE_SYNC_ERROR");

      const receiptRows = await db.query(
        "SELECT id FROM purchase_receipts WHERE transaction_id = ?",
        [transactionId],
      );
      assert.equal(receiptRows.rows.length, 0);
    });

    it("reconciles missing wallet credit when receipt already exists for the same user", async () => {
      const mockAppleValidator = {
        isConfigured: () => true,
        verifyTransaction: async () => {
          throw new Error(
            "validator should not be called for existing receipts",
          );
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
        },
      });

      const transactionId = "gift_tx_missing_credit_1";
      const receiptId = "rcpt_missing_credit_1";
      await db.query(
        `INSERT INTO purchase_receipts (
          id, user_id, subscription_id, transaction_id, original_transaction_id,
          product_id, platform, receipt_data, verification_status, verification_response,
          purchase_date, expires_date, is_trial, is_upgrade, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptId,
          testUserId,
          null,
          transactionId,
          transactionId,
          "com.porizo.gift_token_oneoff",
          "apple",
          null,
          "verified",
          "{}",
          new Date().toISOString(),
          null,
          0,
          0,
          new Date().toISOString(),
        ],
      );

      const response = await appWithMocks.inject({
        method: "POST",
        url: "/billing/receipt/apple/consumable",
        headers: { "x-user-id": testUserId },
        payload: { transactionId },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.success, true);
      assert.equal(body.already_processed, true);
      assert.equal(body.recovered_missing_credit, true);
      assert.equal(body.balance, 1);

      const txRows = await db.query(
        `SELECT type, amount, reference_type, reference_id
         FROM gift_wallet_transactions
         WHERE user_id = ? AND reference_type = 'receipt' AND reference_id = ?`,
        [testUserId, receiptId],
      );
      assert.equal(txRows.rows.length, 1);
      assert.equal(txRows.rows[0].type, "gift_purchase");
      assert.equal(txRows.rows[0].amount, 1);
    });
  });

  describe("POST /billing/receipt/google", () => {
    it("returns 501 when Google billing is not configured", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/receipt/google",
        headers: { "x-user-id": testUserId },
        payload: {
          purchaseToken: "test-token",
          subscriptionId: "com.porizo.plus_monthly",
        },
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

    it("returns 501 for google restore when billing is not configured", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": testUserId },
        payload: {
          platform: "google",
          purchaseToken: "tx-123",
          subscriptionId: "com.porizo.plus_monthly",
        },
      });

      assert.equal(response.statusCode, 501);
    });

    it("restores Google subscription when validator and sync succeed", async () => {
      const mockGoogleValidator = {
        isConfigured: () => true,
        verifySubscription: async (purchaseToken, subscriptionId) => ({
          valid: true,
          orderId: "order-1",
          tier: "plus",
          status: "active",
          expiryTime: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          autoRenewing: true,
          acknowledged: true,
          raw: { lineItems: [{ productId: subscriptionId }] },
        }),
      };

      const mockSubscriptionManager = {
        syncFromGoogle: async () => ({
          id: "sub_google_restore_1",
          tier: "plus",
          status: "active",
          expires_at: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          auto_renewing: true,
        }),
      };

      const appWithMocks = buildServer({
        db,
        config: { STORAGE_DIR: "/tmp/test-storage" },
        storage: {
          put: async () => {},
          get: async () => null,
          exists: async () => false,
          delete: async () => {},
          getSignedUrl: async (key) => `http://localhost/${key}`,
        },
        billingServices: {
          googleValidator: mockGoogleValidator,
          subscriptionManager: mockSubscriptionManager,
        },
      });

      try {
        const response = await appWithMocks.inject({
          method: "POST",
          url: "/billing/restore",
          headers: { "x-user-id": testUserId },
          payload: {
            platform: "google",
            purchaseToken: "purchase-token-1",
            subscriptionId: "com.porizo.plus_monthly",
          },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.success, true);
        assert.equal(body.restored, true);
        assert.equal(body.subscription.id, "sub_google_restore_1");
        assert.equal(body.subscription.tier, "plus");
      } finally {
        await appWithMocks.close();
      }
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
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
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
          [testUserId],
        );
        assert.ok(
          auditRows.rows.length > 0,
          "expected subscription_restored audit entry",
        );
        const metadata = JSON.parse(auditRows.rows[0].metadata_json || "{}");
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
          throw new Error(
            "syncSubscription should not be called for invalid receipts",
          );
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
      const header = Buffer.from(JSON.stringify({ alg: "ES256" })).toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({
          notificationType: "SUBSCRIBED",
          notificationUUID: "test-uuid",
        }),
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
    const GOOGLE_WEBHOOK_TEST_SECRET = "whsec_test_google_billing_api_tests";

    beforeEach(() => {
      process.env.GOOGLE_WEBHOOK_SECRET = GOOGLE_WEBHOOK_TEST_SECRET;
    });

    afterEach(() => {
      delete process.env.GOOGLE_WEBHOOK_SECRET;
    });

    it("ignores non-subscription notifications", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/billing/webhooks/google?token=${GOOGLE_WEBHOOK_TEST_SECRET}`,
        payload: {},
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.received, true);
      assert.equal(body.processed, false);
    });

    it("processes linked subscription notifications", async () => {
      await db.query(
        `INSERT INTO subscriptions (
          id, user_id, product_id, tier, status, platform, original_transaction_id,
          latest_transaction_id, original_purchase_date, expires_at, auto_renew_enabled,
          environment, renewal_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'plus', 'active', 'google', ?, ?, datetime('now'), datetime('now', '+30 day'), 1, 'production', 0, datetime('now'), datetime('now'))`,
        [
          "sub_google_linked",
          testUserId,
          "com.porizo.plus_monthly",
          "purchase_token_google",
          "order_1",
        ],
      );

      const mockGoogleValidator = {
        verifySubscription: async () => ({
          valid: true,
          status: "active",
          orderId: "order_2",
          tier: "plus",
          expiryTime: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          autoRenewing: true,
          acknowledged: true,
          raw: { lineItems: [{ productId: "com.porizo.plus_monthly" }] },
        }),
      };

      const appWithMocks = buildServer({
        db,
        config: { STORAGE_DIR: "/tmp/test-storage" },
        storage: {
          put: async () => {},
          get: async () => null,
          exists: async () => false,
          delete: async () => {},
          getSignedUrl: async (key) => `http://localhost/${key}`,
        },
        billingServices: {
          googleValidator: mockGoogleValidator,
        },
      });

      const payload = {
        message: {
          data: Buffer.from(
            JSON.stringify({
              subscriptionNotification: {
                notificationType: 2,
                purchaseToken: "purchase_token_google",
                subscriptionId: "com.porizo.plus_monthly",
              },
            }),
          ).toString("base64"),
        },
      };

      try {
        const response = await appWithMocks.inject({
          method: "POST",
          url: `/billing/webhooks/google?token=${GOOGLE_WEBHOOK_TEST_SECRET}`,
          payload,
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.received, true);
        assert.equal(body.processed, true);
        assert.equal(body.notificationType, 2);
      } finally {
        await appWithMocks.close();
      }
    });
  });

  describe("Admin endpoints", () => {
    describe("GET /admin/billing/users/:targetUserId", () => {
      it("returns billing snapshot for target user", async () => {
        const response = await app.inject({
          method: "GET",
          url: `/admin/billing/users/${testUserId}`,
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.userId, testUserId);
        assert.ok(Array.isArray(body.recentReceipts));
      });
    });

    describe("POST /admin/billing/sync/apple", () => {
      it("syncs Apple subscription for a target user", async () => {
        const mockAppleValidator = {
          isConfigured: () => true,
          verifyTransaction: async (txId) => ({
            valid: true,
            type: "subscription",
            platform: "apple",
            transactionId: txId,
            originalTransactionId: "orig_tx_1",
            productId: "com.porizo.plus_monthly",
            purchaseDate: new Date(),
            originalPurchaseDate: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            autoRenewEnabled: true,
            isTrialPeriod: false,
            isActive: true,
            isExpired: false,
            isRevoked: false,
            isInGracePeriod: false,
            isInBillingRetry: false,
            environment: "sandbox",
          }),
          getAllSubscriptions: async () => [],
        };

        const mockSubscriptionManager = {
          syncSubscription: async () => ({
            subscriptionId: "sub_admin_sync_1",
            tier: "plus",
            status: "active",
            songsGranted: 4,
            songsRemaining: 4,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            isNewSubscription: true,
            isRenewal: false,
          }),
          getEntitlements: async () => ({
            tier: "plus",
            songsRemaining: 4,
            songsAllowance: 4,
            songsUsedTotal: 0,
            trialSongsRemaining: 0,
            trialExpiresAt: null,
            previewCountToday: 0,
            planId: "plus",
            billingPeriod: "monthly",
            subscriptionStartsAt: new Date(),
            subscriptionRenewsAt: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ),
          }),
          getActiveSubscription: async () => ({
            id: "sub_admin_sync_1",
            tier: "plus",
            status: "active",
            product_id: "com.porizo.plus_monthly",
            platform: "apple",
            expires_at: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            auto_renew_enabled: 1,
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
          const mockAdminToken = await loginAdmin(appWithMocks);
          const response = await appWithMocks.inject({
            method: "POST",
            url: "/admin/billing/sync/apple",
            headers: {
              Authorization: `Bearer ${mockAdminToken}`,
            },
            payload: {
              targetUserId: testUserId,
              transactionId: "tx_admin_sync_123",
            },
          });

          assert.equal(response.statusCode, 200);
          const body = JSON.parse(response.body);
          assert.equal(body.success, true);
          assert.equal(body.targetUserId, testUserId);
          assert.equal(body.syncedCount, 1);
          assert.equal(body.failedCount, 0);
          assert.equal(body.results[0].subscriptionId, "sub_admin_sync_1");
          assert.equal(body.entitlements.tier, "plus");
        } finally {
          await appWithMocks.close();
        }
      });
    });

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

    describe("GET /admin/billing/preflight", () => {
      it("requires admin authentication", async () => {
        const response = await app.inject({
          method: "GET",
          url: "/admin/billing/preflight",
        });

        assert.equal(response.statusCode, 401);
      });

      it("returns runtime subscription linkage checks with admin session", async () => {
        const response = await app.inject({
          method: "GET",
          url: "/admin/billing/preflight?expected_bundle_id=porizo.ios.app.PorizoApp",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(typeof body.ok, "boolean");
        assert.ok(body.checks);
        assert.ok(body.checks.apple_bundle_id);
        assert.ok(body.checks.apple_products);
        assert.ok(Array.isArray(body.issues));
        assert.ok(Array.isArray(body.warnings));
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

describe("buildEntitlementsPayload gift_wallet_balance", () => {
  it("emits gift_wallet_balance from entitlements.giftWalletBalance", () => {
    const payload = buildEntitlementsPayload({
      tier: "free",
      baseSongsRemaining: 0,
      songsRemaining: 0,
      giftWalletBalance: 5,
    });
    assert.equal(payload.gift_wallet_balance, 5);
  });

  it("defaults gift_wallet_balance to 0 when absent", () => {
    const payload = buildEntitlementsPayload({
      tier: "free",
      baseSongsRemaining: 0,
      songsRemaining: 0,
    });
    assert.equal(payload.gift_wallet_balance, 0);
  });

  it("emits gift_wallet_balance 0 for null entitlements", () => {
    const payload = buildEntitlementsPayload(null);
    assert.equal(payload.gift_wallet_balance, 0);
  });
});

describe("buildEntitlementsPayload available_song_credits (pay-per-song)", () => {
  const giftOnly = {
    tier: "free",
    baseSongsRemaining: 0,
    songsRemaining: 0,
    giftWalletBalance: 3,
  };

  it("includes gift_wallet in credits (pay-per-song is permanent)", () => {
    const payload = buildEntitlementsPayload(giftOnly);
    assert.equal(payload.available_song_credits, 3);
    assert.equal(payload.gift_wallet_balance, 3);
    assert.equal(payload.pay_per_song_enabled, true);
  });

  it("counts songsRemaining plus gift_wallet", () => {
    const ent = { ...giftOnly, songsRemaining: 2 };
    assert.equal(
      buildEntitlementsPayload(ent).available_song_credits,
      5, // 2 ongoing + 3 gift
    );
  });

  it("reports pay_per_song_enabled true and credits 0 for null entitlements", () => {
    const payload = buildEntitlementsPayload(null);
    assert.equal(payload.available_song_credits, 0);
    assert.equal(payload.pay_per_song_enabled, true);
  });

  it("clamps a negative gift balance so it never subtracts from ongoing credits", () => {
    const ent = {
      tier: "plus",
      baseSongsRemaining: 0,
      songsRemaining: 5,
      giftWalletBalance: -2, // corrupt data must not reduce real credits
    };
    assert.equal(buildEntitlementsPayload(ent).available_song_credits, 5);
  });
});
