process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAppleWebhookRepository,
} = require("../src/database/apple-webhook-repository");

let db;
let repository;

describe("AppleWebhookRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAppleWebhookRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("claims notifications exactly once", async () => {
    const firstClaim = await repository.claimNotification({
      id: "whn_repo_claim",
      notificationType: "TEST",
      notificationUUID: "apple_repo_claim",
      payloadJson: "{\"raw\":true}",
    });
    const duplicateClaim = await repository.claimNotification({
      id: "whn_repo_claim_duplicate",
      notificationType: "TEST",
      notificationUUID: "apple_repo_claim",
      payloadJson: "{\"raw\":true}",
    });

    assert.equal(firstClaim, true);
    assert.equal(duplicateClaim, false);
    assert.equal(
      await repository.isNotificationProcessed("apple_repo_claim"),
      true,
    );
  });

  test("updates status and lists stats by type", async () => {
    await repository.claimNotification({
      id: "whn_repo_stats_1",
      notificationType: "TEST",
      notificationUUID: "apple_repo_stats_1",
      payloadJson: "{\"raw\":1}",
    });
    await repository.claimNotification({
      id: "whn_repo_stats_2",
      notificationType: "TEST",
      notificationUUID: "apple_repo_stats_2",
      payloadJson: "{\"raw\":2}",
    });

    await repository.updateNotificationStatus({
      notificationUUID: "apple_repo_stats_1",
      status: "completed",
      payloadJson: "{\"result\":true}",
    });

    const updated = await db
      .prepare(
        "SELECT status, payload_json FROM webhook_notifications WHERE notification_uuid = ?",
      )
      .get("apple_repo_stats_1");
    assert.equal(updated.status, "completed");
    assert.equal(updated.payload_json, "{\"result\":true}");

    const stats = await repository.listNotificationStatsByType();
    assert.equal(stats[0].notification_type, "TEST");
    assert.equal(stats[0].count, 2);
  });

  test("upserts dead-letter notifications and increments attempts", async () => {
    await repository.upsertDeadLetterNotification({
      id: "wdlq_repo_1",
      notificationType: "TEST",
      notificationUUID: "apple_repo_dlq",
      rawPayload: "payload-1",
      errorMessage: "first failure",
      errorStack: "stack-1",
    });
    await repository.upsertDeadLetterNotification({
      id: "wdlq_repo_2",
      notificationType: "TEST",
      notificationUUID: "apple_repo_dlq",
      rawPayload: "payload-2",
      errorMessage: "second failure",
      errorStack: "stack-2",
    });

    const row = await db
      .prepare(
        "SELECT raw_payload, attempt_count, error_message, error_stack FROM webhook_dead_letter_queue WHERE notification_uuid = ?",
      )
      .get("apple_repo_dlq");

    assert.equal(row.raw_payload, "payload-1");
    assert.equal(row.attempt_count, 2);
    assert.equal(row.error_message, "second failure");
    assert.equal(row.error_stack, "stack-2");
  });

  test("finds and updates Apple webhook subscription state", async () => {
    await db
      .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
      .run("apple_webhook_user", "2026-06-28T00:00:00.000Z");
    await db
      .prepare(
        `INSERT INTO subscriptions (
          id, user_id, product_id, tier, status, platform,
          original_transaction_id, latest_transaction_id,
          original_purchase_date, expires_at, auto_renew_enabled,
          environment, renewal_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'plus', 'active', 'apple', ?, ?, ?, ?, 1,
                  'production', 0, ?, ?)`,
      )
      .run(
        "sub_apple_webhook",
        "apple_webhook_user",
        "com.porizo.plus_monthly",
        "otx_apple_webhook",
        "tx_apple_webhook",
        "2026-06-28T00:00:00.000Z",
        "2026-07-28T00:00:00.000Z",
        "2026-06-28T00:00:00.000Z",
        "2026-06-28T00:00:00.000Z",
      );

    const subscription =
      await repository.findSubscriptionByOriginalTransactionId(
        "otx_apple_webhook",
      );
    assert.equal(subscription.id, "sub_apple_webhook");
    assert.equal(subscription.user_id, "apple_webhook_user");

    await repository.markSubscriptionBillingRetry("sub_apple_webhook");
    await repository.updateSubscriptionPendingProduct({
      subscriptionId: "sub_apple_webhook",
      pendingProductId: "com.porizo.pro_monthly",
    });
    await repository.updateSubscriptionAutoRenewEnabled({
      subscriptionId: "sub_apple_webhook",
      autoRenewEnabled: false,
    });

    const updated = await db
      .prepare(
        `SELECT status, is_in_billing_retry, pending_product_id, auto_renew_enabled
         FROM subscriptions WHERE id = ?`,
      )
      .get("sub_apple_webhook");

    assert.equal(updated.status, "billing_retry");
    assert.equal(updated.is_in_billing_retry, 1);
    assert.equal(updated.pending_product_id, "com.porizo.pro_monthly");
    assert.equal(updated.auto_renew_enabled, 0);
  });
});
