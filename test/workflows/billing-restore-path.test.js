const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildServer } = require("../../src/server");

function createMockDb() {
  const auditLogs = [];

  return {
    auditLogs,
    prepare(sql) {
      return {
        run(...params) {
          if (sql.includes("INSERT INTO audit_logs")) {
            auditLogs.push({
              id: params[0],
              user_id: params[1],
              action: params[2],
              resource_type: params[3],
              resource_id: params[4],
              metadata_json: params[5],
              created_at: params[6],
            });
          }
          return { changes: 1 };
        },
        get() {
          return null;
        },
        all() {
          return [];
        },
      };
    },
    query() {
      return { rows: [] };
    },
    transaction(fn) {
      return fn(this.query.bind(this));
    },
  };
}

function createStorageMock() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

describe("Billing restore path", () => {
  it("returns restored=true and writes subscription_restored audit entry", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        ALLOW_ANON_USER_ID: true,
      },
      storage: createStorageMock(),
      billingServices: {
        appleValidator: {
          isConfigured: () => true,
          verifyTransaction: async (transactionId) => ({
            valid: true,
            transactionId,
            platform: "apple",
          }),
        },
        subscriptionManager: {
          createFreeEntitlements: async () => {},
          syncSubscription: async () => ({
            subscriptionId: "sub_restore_test",
            tier: "plus",
            status: "active",
            expiresAt: new Date(Date.now() + 86400_000).toISOString(),
            songsRemaining: 4,
          }),
        },
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": "user_restore_test_1" },
        payload: { platform: "apple", transactionId: "tx_restore_test_1" },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.success, true);
      assert.equal(body.restored, true);
      assert.equal(body.subscription.id, "sub_restore_test");
      assert.equal(body.subscription.tier, "plus");

      const restoreAudit = db.auditLogs.find((entry) => entry.action === "subscription_restored");
      assert.ok(restoreAudit, "Expected subscription_restored audit log entry");
      assert.equal(restoreAudit.user_id, "user_restore_test_1");
    } finally {
      await app.close();
    }
  });

  it("returns INVALID_RECEIPT when Apple validator rejects transaction", async () => {
    const db = createMockDb();
    const app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        ALLOW_ANON_USER_ID: true,
      },
      storage: createStorageMock(),
      billingServices: {
        appleValidator: {
          isConfigured: () => true,
          verifyTransaction: async () => ({
            valid: false,
            error: "transaction_not_found",
          }),
        },
        subscriptionManager: {
          createFreeEntitlements: async () => {},
          syncSubscription: async () => {
            throw new Error("should_not_be_called");
          },
        },
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/billing/restore",
        headers: { "x-user-id": "user_restore_test_2" },
        payload: { platform: "apple", transactionId: "tx_restore_invalid" },
      });

      assert.equal(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "INVALID_RECEIPT");
      assert.equal(db.auditLogs.length, 0);
    } finally {
      await app.close();
    }
  });
});
