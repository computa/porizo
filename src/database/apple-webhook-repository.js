"use strict";

function resultChanges(result) {
  return result?.changes ?? result?.rowCount ?? 0;
}

function createAppleWebhookRepository(db) {
  async function isNotificationProcessed(notificationUUID) {
    const row = await db
      .prepare(
        "SELECT id FROM webhook_notifications WHERE platform = 'apple' AND notification_uuid = ?",
      )
      .get(notificationUUID);
    return Boolean(row);
  }

  async function claimNotification({
    id,
    notificationType,
    notificationUUID,
    payloadJson,
  }) {
    const result = await db
      .prepare(
        `INSERT INTO webhook_notifications
         (id, platform, notification_type, notification_uuid, subscription_id,
          user_id, payload_json, status, processed_at, created_at)
         VALUES (?, 'apple', ?, ?, NULL, NULL, ?, 'pending',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (platform, notification_uuid) DO NOTHING`,
      )
      .run(id, notificationType, notificationUUID, payloadJson);
    return resultChanges(result) > 0;
  }

  async function updateNotificationStatus({
    notificationUUID,
    status,
    payloadJson = null,
  }) {
    if (payloadJson !== null) {
      return db
        .prepare(
          `UPDATE webhook_notifications
           SET status = ?, processed_at = CURRENT_TIMESTAMP, payload_json = ?
           WHERE platform = 'apple' AND notification_uuid = ?`,
        )
        .run(status, payloadJson, notificationUUID);
    }

    return db
      .prepare(
        `UPDATE webhook_notifications
         SET status = ?, processed_at = CURRENT_TIMESTAMP
         WHERE platform = 'apple' AND notification_uuid = ?`,
      )
      .run(status, notificationUUID);
  }

  async function upsertDeadLetterNotification({
    id,
    notificationType,
    notificationUUID,
    rawPayload,
    errorMessage,
    errorStack,
  }) {
    return db
      .prepare(
        `INSERT INTO webhook_dead_letter_queue
         (id, platform, notification_type, notification_uuid, raw_payload,
          error_message, error_stack)
         VALUES (?, 'apple', ?, ?, ?, ?, ?)
         ON CONFLICT(platform, notification_uuid) DO UPDATE SET
           attempt_count = attempt_count + 1,
           last_failed_at = CURRENT_TIMESTAMP,
           error_message = excluded.error_message,
           error_stack = excluded.error_stack`,
      )
      .run(
        id,
        notificationType,
        notificationUUID,
        rawPayload,
        errorMessage,
        errorStack,
      );
  }

  async function listNotificationStatsByType() {
    return db
      .prepare(
        `SELECT
           notification_type,
           COUNT(*) as count,
           MIN(created_at) as first_received,
           MAX(created_at) as last_received
         FROM webhook_notifications
         WHERE platform = 'apple'
         GROUP BY notification_type
         ORDER BY count DESC`,
      )
      .all();
  }

  async function findSubscriptionByOriginalTransactionId(originalTransactionId) {
    return db
      .prepare(
        `SELECT s.*, u.id as user_id
         FROM subscriptions s
         JOIN users u ON s.user_id = u.id
         WHERE s.original_transaction_id = ?`,
      )
      .get(originalTransactionId);
  }

  async function markSubscriptionBillingRetry(subscriptionId) {
    return db
      .prepare(
        `UPDATE subscriptions SET
           status = 'billing_retry',
           is_in_billing_retry = 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(subscriptionId);
  }

  async function updateSubscriptionPendingProduct({
    subscriptionId,
    pendingProductId,
  }) {
    return db
      .prepare(
        `UPDATE subscriptions SET
           pending_product_id = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(pendingProductId, subscriptionId);
  }

  async function updateSubscriptionAutoRenewEnabled({
    subscriptionId,
    autoRenewEnabled,
  }) {
    return db
      .prepare(
        `UPDATE subscriptions SET
           auto_renew_enabled = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(autoRenewEnabled ? 1 : 0, subscriptionId);
  }

  return {
    isNotificationProcessed,
    claimNotification,
    updateNotificationStatus,
    upsertDeadLetterNotification,
    listNotificationStatsByType,
    findSubscriptionByOriginalTransactionId,
    markSubscriptionBillingRetry,
    updateSubscriptionPendingProduct,
    updateSubscriptionAutoRenewEnabled,
  };
}

module.exports = {
  createAppleWebhookRepository,
};
