const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { syncPendingRenewals } = require("../src/jobs/subscription-sync");

function createDbMock({ pendingSubscriptions = [], gracePeriodExpired = [] } = {}) {
  return {
    prepare(sql) {
      if (sql.includes("FROM subscriptions s")) {
        return {
          all: async () => pendingSubscriptions,
        };
      }
      if (sql.includes("WHERE status = 'grace_period'")) {
        return {
          all: async () => gracePeriodExpired,
        };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

describe("Subscription sync job", () => {
  it("syncs active Apple subscriptions using verifyTransaction contract", async () => {
    const db = createDbMock({
      pendingSubscriptions: [
        {
          id: "sub_1",
          user_id: "user_1",
          platform: "apple",
          latest_transaction_id: "tx_latest_1",
          original_transaction_id: "orig_1",
        },
      ],
    });

    let syncedUserId = null;
    let syncedValidation = null;
    const subscriptionManager = {
      syncSubscription: async (userId, validation) => {
        syncedUserId = userId;
        syncedValidation = validation;
        return { isRenewal: true, songsGranted: 4 };
      },
      handleExpiration: async () => {
        throw new Error("handleExpiration should not be called");
      },
      handleRevocation: async () => {
        throw new Error("handleRevocation should not be called");
      },
    };

    const appleValidator = {
      verifyTransaction: async (transactionId) => ({
        valid: true,
        type: "subscription",
        transactionId,
        originalTransactionId: "orig_1",
        productId: "com.porizo.plus_monthly",
        platform: "apple",
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
    };

    const result = await syncPendingRenewals({
      db,
      subscriptionManager,
      appleValidator,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.renewed, 1);
    assert.equal(result.expired, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(syncedUserId, "user_1");
    assert.equal(syncedValidation.transactionId, "tx_latest_1");
  });

  it("expires subscriptions when Apple validation reports expired", async () => {
    const db = createDbMock({
      pendingSubscriptions: [
        {
          id: "sub_2",
          user_id: "user_2",
          platform: "apple",
          latest_transaction_id: "tx_latest_2",
          original_transaction_id: "orig_2",
        },
      ],
    });

    let expiredSubId = null;
    const subscriptionManager = {
      syncSubscription: async () => {
        throw new Error("syncSubscription should not be called for expired subs");
      },
      handleExpiration: async (subscriptionId) => {
        expiredSubId = subscriptionId;
      },
      handleRevocation: async () => {
        throw new Error("handleRevocation should not be called");
      },
    };

    const appleValidator = {
      verifyTransaction: async () => ({
        valid: true,
        type: "subscription",
        isActive: false,
        isExpired: true,
        isRevoked: false,
        isInGracePeriod: false,
        isInBillingRetry: false,
      }),
    };

    const result = await syncPendingRenewals({
      db,
      subscriptionManager,
      appleValidator,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.renewed, 0);
    assert.equal(result.expired, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(expiredSubId, "sub_2");
  });

  it("records validation errors without mutating subscription state", async () => {
    const db = createDbMock({
      pendingSubscriptions: [
        {
          id: "sub_3",
          user_id: "user_3",
          platform: "apple",
          latest_transaction_id: "tx_latest_3",
          original_transaction_id: "orig_3",
        },
      ],
    });

    const subscriptionManager = {
      syncSubscription: async () => {
        throw new Error("syncSubscription should not be called on invalid receipts");
      },
      handleExpiration: async () => {
        throw new Error("handleExpiration should not be called on invalid receipts");
      },
      handleRevocation: async () => {
        throw new Error("handleRevocation should not be called on invalid receipts");
      },
    };

    const appleValidator = {
      verifyTransaction: async () => ({
        valid: false,
        error: "transaction_not_found",
      }),
    };

    const result = await syncPendingRenewals({
      db,
      subscriptionManager,
      appleValidator,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.renewed, 0);
    assert.equal(result.expired, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /transaction_not_found/);
  });

  it("skips non-subscription validation types", async () => {
    const db = createDbMock({
      pendingSubscriptions: [
        {
          id: "sub_type_guard",
          user_id: "user_type",
          platform: "apple",
          latest_transaction_id: "tx_otp_1",
          original_transaction_id: "orig_otp_1",
        },
      ],
    });

    const subscriptionManager = {
      syncSubscription: async () => {
        throw new Error("syncSubscription should not be called for non-subscription types");
      },
      handleExpiration: async () => {
        throw new Error("handleExpiration should not be called");
      },
      handleRevocation: async () => {
        throw new Error("handleRevocation should not be called");
      },
    };

    const appleValidator = {
      verifyTransaction: async () => ({
        valid: true,
        type: "one_time_purchase",
        transactionId: "tx_otp_1",
        productId: "com.porizo.tip",
      }),
    };

    const result = await syncPendingRenewals({
      db,
      subscriptionManager,
      appleValidator,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.renewed, 0);
    assert.equal(result.expired, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /one_time_purchase/);
  });
});
