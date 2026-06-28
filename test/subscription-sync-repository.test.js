process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createSubscriptionSyncRepository,
} = require("../src/database/subscription-sync-repository");

async function seedEntitlement(db, {
  userId,
  renewsAt = null,
} = {}) {
  await db.prepare(`
    INSERT INTO entitlements (user_id, tier, subscription_renews_at, updated_at)
    VALUES (?, 'plus', ?, ?)
  `).run(userId, renewsAt, "2026-06-27T00:00:00.000Z");
}

async function seedSubscription(db, {
  id,
  userId,
  status = "active",
  platform = "apple",
  productId = "com.porizo.plus_monthly",
  originalTransactionId = `orig_${id}`,
  latestTransactionId = `tx_${id}`,
  expiresAt = "2026-06-01T00:00:00.000Z",
  autoRenewEnabled = 1,
  gracePeriodExpiresAt = null,
} = {}) {
  await db.prepare(`
    INSERT INTO subscriptions (
      id, user_id, product_id, tier, status, platform,
      original_transaction_id, latest_transaction_id, expires_at,
      auto_renew_enabled, grace_period_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'plus', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    productId,
    status,
    platform,
    originalTransactionId,
    latestTransactionId,
    expiresAt,
    autoRenewEnabled,
    gracePeriodExpiresAt,
    "2026-05-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
  );
}

describe("SubscriptionSyncRepository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createSubscriptionSyncRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("lists renewal candidates with cursor pagination and eligibility filters", async () => {
    await seedEntitlement(db, {
      userId: "user_a",
      renewsAt: "2026-06-01T00:00:00.000Z",
    });
    await seedEntitlement(db, {
      userId: "user_b",
      renewsAt: "2026-06-01T00:00:00.000Z",
    });
    await seedEntitlement(db, {
      userId: "user_future",
      renewsAt: "2026-07-01T00:00:00.000Z",
    });
    await seedSubscription(db, {
      id: "sub_a",
      userId: "user_a",
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    await seedSubscription(db, {
      id: "sub_b",
      userId: "user_b",
      status: "grace_period",
      expiresAt: "2026-07-01T00:00:00.000Z",
    });
    await seedSubscription(db, {
      id: "sub_cancelled",
      userId: "user_cancelled",
      status: "cancelled",
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    await seedSubscription(db, {
      id: "sub_manual",
      userId: "user_manual",
      expiresAt: "2026-06-01T00:00:00.000Z",
      autoRenewEnabled: 0,
    });
    await seedSubscription(db, {
      id: "sub_future",
      userId: "user_future",
      expiresAt: "2026-07-01T00:00:00.000Z",
    });

    const firstPage = await repository.listPendingRenewalSubscriptions({
      cursor: "",
      now: "2026-06-27T00:00:00.000Z",
      limit: 1,
    });
    const secondPage = await repository.listPendingRenewalSubscriptions({
      cursor: firstPage[0].id,
      now: "2026-06-27T00:00:00.000Z",
      limit: 10,
    });

    assert.deepEqual(firstPage.map((row) => row.id), ["sub_a"]);
    assert.deepEqual(secondPage.map((row) => row.id), ["sub_b"]);
    assert.equal(secondPage[0].subscription_renews_at, "2026-06-01T00:00:00.000Z");
  });

  test("lists expired grace-period subscriptions only", async () => {
    await seedSubscription(db, {
      id: "sub_grace_expired",
      userId: "user_grace_expired",
      status: "grace_period",
      gracePeriodExpiresAt: "2026-06-01T00:00:00.000Z",
    });
    await seedSubscription(db, {
      id: "sub_grace_future",
      userId: "user_grace_future",
      status: "grace_period",
      gracePeriodExpiresAt: "2026-07-01T00:00:00.000Z",
    });
    await seedSubscription(db, {
      id: "sub_active_expired_grace_field",
      userId: "user_active",
      status: "active",
      gracePeriodExpiresAt: "2026-06-01T00:00:00.000Z",
    });

    const rows = await repository.listExpiredGracePeriodSubscriptions({
      now: "2026-06-27T00:00:00.000Z",
    });

    assert.deepEqual(rows.map((row) => row.id), ["sub_grace_expired"]);
  });
});
