/**
 * Apple Webhook Handler Tests
 *
 * Tests notification processing, idempotency, and subscription lifecycle events.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { createPlanConfigService } = require("../src/services/plan-config");
const {
  createSubscriptionManager,
} = require("../src/services/subscription-manager");
const {
  createAppleWebhookHandler,
  NOTIFICATION_TYPES,
  NOTIFICATION_SUBTYPES,
} = require("../src/services/apple-webhook-handler");

/**
 * Create a mock JWS payload for testing
 */
function createMockJWS(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "ES256" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Create a mock notification payload
 */
function createMockNotification(overrides = {}) {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const transactionInfo = {
    transactionId: `tx_${uniqueId}`,
    originalTransactionId: overrides.originalTransactionId || `otx_${uniqueId}`,
    productId: "com.porizo.plus_monthly",
    purchaseDate: Date.now(),
    expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    ...overrides.transactionInfo,
  };

  const renewalInfo = {
    autoRenewStatus: 1,
    autoRenewProductId: "com.porizo.plus_monthly",
    ...overrides.renewalInfo,
  };

  return {
    notificationType: NOTIFICATION_TYPES.SUBSCRIBED,
    subtype: NOTIFICATION_SUBTYPES.INITIAL_BUY,
    notificationUUID: overrides.notificationUUID || `uuid_${uniqueId}`,
    version: "2.0",
    signedDate: Date.now(),
    data: {
      signedTransactionInfo: createMockJWS(transactionInfo),
      signedRenewalInfo: createMockJWS(renewalInfo),
    },
    ...overrides,
  };
}

describe("Apple Webhook Handler", async () => {
  let db;
  let planService;
  let subscriptionManager;
  let webhookHandler;
  let testUserId;

  beforeEach(async () => {
    db = await getDatabase();
    planService = createPlanConfigService(db);
    subscriptionManager = createSubscriptionManager(db, {
      planConfigService: planService,
    });

    // Create mock apple validator for decoding
    const mockAppleValidator = {
      decodeJWS: (jws) => {
        try {
          const parts = jws.split(".");
          if (parts.length !== 3) return null;
          return JSON.parse(
            Buffer.from(parts[1], "base64url").toString("utf8"),
          );
        } catch {
          return null;
        }
      },
    };

    webhookHandler = createAppleWebhookHandler(db, {
      subscriptionManager,
      appleValidator: mockAppleValidator,
      planConfigService: planService,
    });

    // Create test user
    testUserId = `user_webhook_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.query(
      "INSERT INTO users (id, created_at) VALUES (?, datetime('now'))",
      [testUserId],
    );
  });

  describe("processNotification", () => {
    it("decodes and processes valid notification", async () => {
      const notification = createMockNotification();
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.notificationType, NOTIFICATION_TYPES.SUBSCRIBED);
      assert.ok(result.notificationUUID);
    });

    it("rejects invalid payload", async () => {
      const result = await webhookHandler.processNotification("invalid-jws");

      assert.equal(result.success, false);
      assert.equal(result.error, "INVALID_PAYLOAD");
    });

    it("implements idempotency - processes same notification only once", async () => {
      const notificationUUID = `uuid_idempotent_${Date.now()}`;
      const notification = createMockNotification({ notificationUUID });
      const signedPayload = createMockJWS(notification);

      // First processing
      const result1 = await webhookHandler.processNotification(signedPayload);
      assert.equal(result1.success, true);
      assert.equal(result1.skipped, undefined);

      // Second processing should be skipped
      const result2 = await webhookHandler.processNotification(signedPayload);
      assert.equal(result2.success, true);
      assert.equal(result2.skipped, true);
      assert.equal(result2.reason, "ALREADY_PROCESSED");
    });

    it("handles TEST notification type", async () => {
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.TEST,
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.notificationType, NOTIFICATION_TYPES.TEST);
      assert.equal(result.result.action, "test_acknowledged");
    });

    it("handles unknown notification type gracefully", async () => {
      const notification = createMockNotification({
        notificationType: "UNKNOWN_TYPE",
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, false);
      assert.equal(result.result.action, "unknown_notification_type");
    });
  });

  describe("SUBSCRIBED notifications", () => {
    it("defers processing when user not found", async () => {
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.SUBSCRIBED,
        subtype: NOTIFICATION_SUBTYPES.INITIAL_BUY,
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, false);
      assert.equal(result.result.reason, "USER_NOT_FOUND");
    });

    it("processes subscription for existing user with subscription", async () => {
      // First create a subscription via the manager
      const originalTxId = `otx_existing_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Now send a renewal webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_RENEW,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.userId, testUserId);
    });
  });

  describe("DID_RENEW notifications", () => {
    it("processes renewal for existing subscription", async () => {
      // Create initial subscription
      const originalTxId = `otx_renew_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send renewal webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_RENEW,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
          transactionId: `tx_renew_${Date.now()}`,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.notificationType, NOTIFICATION_TYPES.DID_RENEW);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "renewed");
    });

    it("defers when subscription not found", async () => {
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_RENEW,
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, false);
      assert.equal(result.result.reason, "SUBSCRIPTION_NOT_FOUND");
    });
  });

  describe("EXPIRED notifications", () => {
    it("expires subscription and downgrades tier", async () => {
      // Create initial subscription
      const originalTxId = `otx_expire_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: false,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send expiry webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.EXPIRED,
        subtype: NOTIFICATION_SUBTYPES.VOLUNTARY,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "expired");
      assert.equal(result.result.previousTier, "plus");
      assert.equal(result.result.newTier, "free");
    });
  });

  describe("DID_FAIL_TO_RENEW notifications", () => {
    it("enters grace period when subtype is GRACE_PERIOD", async () => {
      // Create initial subscription
      const originalTxId = `otx_grace_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send grace period webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_FAIL_TO_RENEW,
        subtype: NOTIFICATION_SUBTYPES.GRACE_PERIOD,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "grace_period_started");
    });

    it("enters billing retry when no grace period", async () => {
      // Create initial subscription
      const originalTxId = `otx_retry_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send billing retry webhook (no subtype)
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_FAIL_TO_RENEW,
        subtype: NOTIFICATION_SUBTYPES.BILLING_RETRY,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "billing_retry_started");
    });
  });

  describe("REFUND notifications", () => {
    it("revokes subscription and removes songs", async () => {
      // Create initial subscription
      const originalTxId = `otx_refund_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Verify songs were granted (plus plan grants 10/month since migration 075)
      let ent = await subscriptionManager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 10);

      // Send refund webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.REFUND,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "refunded");
      assert.equal(result.result.songsRevoked, 10);

      // Verify songs were revoked
      ent = await subscriptionManager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 0);
    });
  });

  describe("REVOKE notifications", () => {
    it("revokes family sharing subscription", async () => {
      // Create initial subscription
      const originalTxId = `otx_revoke_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send revoke webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.REVOKE,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
          revocationDate: Date.now(),
          revocationReason: 1,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "revoked");
    });
  });

  describe("DID_CHANGE_RENEWAL_STATUS notifications", () => {
    it("updates auto-renew to enabled", async () => {
      // Create initial subscription
      const originalTxId = `otx_autorenew_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: false,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send auto-renew enabled webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_CHANGE_RENEWAL_STATUS,
        subtype: NOTIFICATION_SUBTYPES.AUTO_RENEW_ENABLED,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "auto_renew_enabled");
    });

    it("updates auto-renew to disabled", async () => {
      // Create initial subscription
      const originalTxId = `otx_noautorenew_${Date.now()}`;
      const mockValidation = {
        valid: true,
        type: "subscription",
        platform: "apple",
        transactionId: `tx_init_${Date.now()}`,
        originalTransactionId: originalTxId,
        productId: "com.porizo.plus_monthly",
        status: "active",
        isActive: true,
        isExpired: false,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
        purchaseDate: new Date(),
        originalPurchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        autoRenewEnabled: true,
        isTrialPeriod: false,
        environment: "sandbox",
      };

      await subscriptionManager.syncSubscription(testUserId, mockValidation);

      // Send auto-renew disabled webhook
      const notification = createMockNotification({
        notificationType: NOTIFICATION_TYPES.DID_CHANGE_RENEWAL_STATUS,
        subtype: NOTIFICATION_SUBTYPES.AUTO_RENEW_DISABLED,
        originalTransactionId: originalTxId,
        transactionInfo: {
          originalTransactionId: originalTxId,
        },
      });
      const signedPayload = createMockJWS(notification);

      const result = await webhookHandler.processNotification(signedPayload);

      assert.equal(result.success, true);
      assert.equal(result.result.handled, true);
      assert.equal(result.result.action, "auto_renew_disabled");
    });
  });

  describe("getStats", () => {
    it("returns notification statistics", async () => {
      // Process a few notifications
      const notification1 = createMockNotification({
        notificationType: NOTIFICATION_TYPES.TEST,
      });
      const notification2 = createMockNotification({
        notificationType: NOTIFICATION_TYPES.TEST,
      });

      await webhookHandler.processNotification(createMockJWS(notification1));
      await webhookHandler.processNotification(createMockJWS(notification2));

      const stats = await webhookHandler.getStats();

      assert.equal(stats.platform, "apple");
      assert.ok(stats.total >= 2);
      assert.ok(Array.isArray(stats.byType));
    });
  });

  describe("constants", () => {
    it("exports notification types", () => {
      assert.ok(NOTIFICATION_TYPES.SUBSCRIBED);
      assert.ok(NOTIFICATION_TYPES.DID_RENEW);
      assert.ok(NOTIFICATION_TYPES.EXPIRED);
      assert.ok(NOTIFICATION_TYPES.REFUND);
      assert.ok(NOTIFICATION_TYPES.REVOKE);
    });

    it("exports notification subtypes", () => {
      assert.ok(NOTIFICATION_SUBTYPES.INITIAL_BUY);
      assert.ok(NOTIFICATION_SUBTYPES.RESUBSCRIBE);
      assert.ok(NOTIFICATION_SUBTYPES.GRACE_PERIOD);
      assert.ok(NOTIFICATION_SUBTYPES.AUTO_RENEW_ENABLED);
    });
  });
});
