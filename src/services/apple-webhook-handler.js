/**
 * Apple App Store Server Notifications v2 Handler
 *
 * Processes webhooks from Apple for subscription lifecycle events.
 * Implements idempotent processing via notification_uuid tracking.
 *
 * Notification types handled:
 * - SUBSCRIBED: New subscription
 * - DID_RENEW: Subscription renewed
 * - EXPIRED: Subscription expired
 * - GRACE_PERIOD_EXPIRED: Grace period ended
 * - DID_FAIL_TO_RENEW: Billing retry started
 * - REFUND: Transaction refunded
 * - REVOKE: Family sharing revoked
 *
 * @see https://developer.apple.com/documentation/appstoreservernotifications
 */

const crypto = require("crypto");

/**
 * Apple notification types
 * @see https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
 */
const NOTIFICATION_TYPES = {
  SUBSCRIBED: "SUBSCRIBED",
  DID_RENEW: "DID_RENEW",
  EXPIRED: "EXPIRED",
  GRACE_PERIOD_EXPIRED: "GRACE_PERIOD_EXPIRED",
  DID_FAIL_TO_RENEW: "DID_FAIL_TO_RENEW",
  DID_CHANGE_RENEWAL_PREF: "DID_CHANGE_RENEWAL_PREF",
  DID_CHANGE_RENEWAL_STATUS: "DID_CHANGE_RENEWAL_STATUS",
  OFFER_REDEEMED: "OFFER_REDEEMED",
  REFUND: "REFUND",
  REFUND_DECLINED: "REFUND_DECLINED",
  REFUND_REVERSED: "REFUND_REVERSED",
  CONSUMPTION_REQUEST: "CONSUMPTION_REQUEST",
  RENEWAL_EXTENDED: "RENEWAL_EXTENDED",
  REVOKE: "REVOKE",
  TEST: "TEST",
  PRICE_INCREASE: "PRICE_INCREASE",
  RENEWAL_EXTENSION: "RENEWAL_EXTENSION",
};

/**
 * Notification subtypes for additional context
 */
const NOTIFICATION_SUBTYPES = {
  INITIAL_BUY: "INITIAL_BUY",
  RESUBSCRIBE: "RESUBSCRIBE",
  DOWNGRADE: "DOWNGRADE",
  UPGRADE: "UPGRADE",
  AUTO_RENEW_ENABLED: "AUTO_RENEW_ENABLED",
  AUTO_RENEW_DISABLED: "AUTO_RENEW_DISABLED",
  VOLUNTARY: "VOLUNTARY",
  BILLING_RETRY: "BILLING_RETRY",
  PRICE_INCREASE: "PRICE_INCREASE",
  GRACE_PERIOD: "GRACE_PERIOD",
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
};

/**
 * Creates an Apple webhook handler
 *
 * @param {Object} db - Database instance
 * @param {Object} options - Configuration options
 * @param {Object} options.subscriptionManager - Subscription manager instance
 * @param {Object} options.appleValidator - Apple receipt validator instance
 * @returns {Object} Webhook handler methods
 */
function createAppleWebhookHandler(db, options = {}) {
  const { subscriptionManager, appleValidator } = options;

  if (!subscriptionManager) {
    throw new Error("subscriptionManager is required");
  }

  /**
   * Get query function based on database type
   */
  function getQuery() {
    if (typeof db.query === "function") {
      return db.query.bind(db);
    }
    return async (sql, params) => {
      const stmt = await db.prepare(sql);
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        return { rows: stmt.all(...(params || [])) };
      }
      const result = stmt.run(...(params || []));
      return { changes: result.changes };
    };
  }

  const query = getQuery();

  /**
   * Check if a notification has already been processed (idempotency)
   *
   * @param {string} notificationUUID - Apple's notification UUID
   * @returns {Promise<boolean>} True if already processed
   */
  async function isNotificationProcessed(notificationUUID) {
    const result = await query(
      "SELECT id FROM webhook_notifications WHERE platform = 'apple' AND notification_uuid = ?",
      [notificationUUID]
    );
    return result.rows.length > 0;
  }

  /**
   * Record notification BEFORE processing (pending status)
   * This ensures we never lose a webhook even if processing crashes
   *
   * @param {Object} notification - Notification data
   * @param {string} status - 'pending', 'processing', 'completed', 'failed'
   * @returns {Promise<string>} Record ID
   */
  async function recordNotification(notification, status = "completed") {
    const id = `whn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    await query(
      `INSERT INTO webhook_notifications
       (id, platform, notification_type, notification_uuid, subscription_id, user_id, payload_json, status, processed_at, created_at)
       VALUES (?, 'apple', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        notification.notificationType,
        notification.notificationUUID,
        notification.subscriptionId || null,
        notification.userId || null,
        JSON.stringify(notification.payload || {}),
        status,
      ]
    );
    return id;
  }

  /**
   * Update notification status after processing
   *
   * @param {string} notificationUUID - Notification UUID
   * @param {string} status - New status
   * @param {Object} result - Processing result to store
   */
  async function updateNotificationStatus(notificationUUID, status, result = null) {
    const payloadUpdate = result ? `, payload_json = ?` : "";
    const params = result
      ? [status, JSON.stringify(result), notificationUUID]
      : [status, notificationUUID];

    await query(
      `UPDATE webhook_notifications
       SET status = ?, processed_at = CURRENT_TIMESTAMP${payloadUpdate}
       WHERE platform = 'apple' AND notification_uuid = ?`,
      params
    );
  }

  /**
   * Move failed notification to dead-letter queue for later retry
   *
   * @param {Object} notification - Original notification data
   * @param {Error} error - The error that occurred
   * @param {string} rawPayload - Original raw payload for replay
   */
  async function moveToDeadLetterQueue(notification, error, rawPayload) {
    const id = `wdlq_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    try {
      // Try to insert or update existing DLQ entry
      await query(
        `INSERT INTO webhook_dead_letter_queue
         (id, platform, notification_type, notification_uuid, raw_payload, error_message, error_stack)
         VALUES (?, 'apple', ?, ?, ?, ?, ?)
         ON CONFLICT(platform, notification_uuid) DO UPDATE SET
           attempt_count = attempt_count + 1,
           last_failed_at = CURRENT_TIMESTAMP,
           error_message = excluded.error_message,
           error_stack = excluded.error_stack`,
        [
          id,
          notification.notificationType,
          notification.notificationUUID,
          rawPayload,
          error.message,
          error.stack || null,
        ]
      );

      console.error(
        `[Apple Webhook] Moved to DLQ: ${notification.notificationType} (${notification.notificationUUID})`
      );
    } catch (dlqError) {
      // Last resort: log to console if DLQ insert fails
      console.error("[Apple Webhook] CRITICAL: Failed to write to DLQ:", dlqError);
      console.error("[Apple Webhook] Lost notification:", JSON.stringify(notification));
    }
  }

  /**
   * Find user by original transaction ID
   *
   * @param {string} originalTransactionId - Apple's original transaction ID
   * @returns {Promise<Object|null>} Subscription and user info
   */
  async function findSubscriptionByOriginalTxId(originalTransactionId) {
    const result = await query(
      `SELECT s.*, u.id as user_id
       FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       WHERE s.original_transaction_id = ?`,
      [originalTransactionId]
    );
    return result.rows[0] || null;
  }

  /**
   * Decode and parse notification payload
   * Note: Full JWS signature verification should use Apple's certificates
   *
   * @param {string} signedPayload - JWS signed payload from Apple
   * @returns {Object|null} Decoded notification or null if invalid
   */
  function decodeNotification(signedPayload) {
    if (!appleValidator) {
      // Fallback to basic decode without signature verification
      return basicDecodeJWS(signedPayload);
    }
    return appleValidator.decodeJWS(signedPayload);
  }

  /**
   * Basic JWS decode without signature verification
   * Used for development/testing only
   *
   * @param {string} jws - JWS token
   * @returns {Object|null} Decoded payload or null
   */
  function basicDecodeJWS(jws) {
    try {
      const parts = jws.split(".");
      if (parts.length !== 3) return null;

      const payload = Buffer.from(parts[1], "base64url").toString("utf8");
      return JSON.parse(payload);
    } catch (err) {
      console.error("[Apple Webhook] Failed to decode JWS:", err.message);
      return null;
    }
  }

  /**
   * Extract transaction info from notification data
   *
   * @param {Object} data - Notification data object
   * @returns {Object} Extracted transaction details
   */
  function extractTransactionInfo(data) {
    // App Store Server Notifications v2 structure
    const signedTransactionInfo = data?.signedTransactionInfo;
    const signedRenewalInfo = data?.signedRenewalInfo;

    let transactionInfo = null;
    let renewalInfo = null;

    if (signedTransactionInfo) {
      transactionInfo = decodeNotification(signedTransactionInfo);
    }

    if (signedRenewalInfo) {
      renewalInfo = decodeNotification(signedRenewalInfo);
    }

    return {
      transactionInfo,
      renewalInfo,
      // Extract key fields with fallbacks
      transactionId: transactionInfo?.transactionId,
      originalTransactionId: transactionInfo?.originalTransactionId,
      productId: transactionInfo?.productId,
      purchaseDate: transactionInfo?.purchaseDate
        ? new Date(transactionInfo.purchaseDate)
        : null,
      expiresDate: transactionInfo?.expiresDate
        ? new Date(transactionInfo.expiresDate)
        : null,
      autoRenewStatus: renewalInfo?.autoRenewStatus,
      autoRenewProductId: renewalInfo?.autoRenewProductId,
      revocationDate: transactionInfo?.revocationDate
        ? new Date(transactionInfo.revocationDate)
        : null,
      revocationReason: transactionInfo?.revocationReason,
    };
  }

  /**
   * Process an Apple webhook notification
   *
   * Uses record-before-process pattern to ensure no webhooks are lost:
   * 1. Record notification as 'pending' BEFORE processing
   * 2. Update to 'completed' or 'failed' AFTER processing
   * 3. Failed notifications go to dead-letter queue for retry
   *
   * @param {string} signedPayload - JWS signed payload from Apple
   * @returns {Promise<Object>} Processing result
   */
  async function processNotification(signedPayload) {
    // Decode the outer notification
    const notification = decodeNotification(signedPayload);

    if (!notification) {
      return {
        success: false,
        error: "INVALID_PAYLOAD",
        message: "Failed to decode notification payload",
      };
    }

    const {
      notificationType,
      subtype,
      notificationUUID,
      data,
      version,
      signedDate,
    } = notification;

    // Check idempotency
    if (await isNotificationProcessed(notificationUUID)) {
      return {
        success: true,
        skipped: true,
        reason: "ALREADY_PROCESSED",
        notificationUUID,
      };
    }

    // RECORD-BEFORE-PROCESS: Record notification as pending FIRST
    // This ensures we never lose a webhook even if the server crashes mid-processing
    await recordNotification(
      {
        notificationType,
        notificationUUID,
        subscriptionId: null,
        userId: null,
        payload: { subtype, version, signedDate, rawPayload: signedPayload },
      },
      "pending"
    );

    // Extract transaction details
    const txInfo = extractTransactionInfo(data);

    // Find existing subscription
    let subscription = null;
    let userId = null;

    if (txInfo.originalTransactionId) {
      subscription = await findSubscriptionByOriginalTxId(
        txInfo.originalTransactionId
      );
      if (subscription) {
        userId = subscription.user_id;
      }
    }

    // Process based on notification type
    let result;
    let processingError = null;
    try {
      switch (notificationType) {
        case NOTIFICATION_TYPES.SUBSCRIBED:
          result = await handleSubscribed(subscription, userId, txInfo, subtype);
          break;

        case NOTIFICATION_TYPES.DID_RENEW:
          result = await handleRenewal(subscription, userId, txInfo);
          break;

        case NOTIFICATION_TYPES.EXPIRED:
          result = await handleExpired(subscription, txInfo, subtype);
          break;

        case NOTIFICATION_TYPES.GRACE_PERIOD_EXPIRED:
          result = await handleGracePeriodExpired(subscription);
          break;

        case NOTIFICATION_TYPES.DID_FAIL_TO_RENEW:
          result = await handleFailedRenewal(subscription, txInfo, subtype);
          break;

        case NOTIFICATION_TYPES.REFUND:
          result = await handleRefund(subscription, txInfo);
          break;

        case NOTIFICATION_TYPES.REVOKE:
          result = await handleRevoke(subscription, txInfo);
          break;

        case NOTIFICATION_TYPES.DID_CHANGE_RENEWAL_PREF:
          result = await handleRenewalPrefChange(subscription, txInfo);
          break;

        case NOTIFICATION_TYPES.DID_CHANGE_RENEWAL_STATUS:
          result = await handleRenewalStatusChange(subscription, txInfo, subtype);
          break;

        case NOTIFICATION_TYPES.TEST:
          result = { handled: true, action: "test_acknowledged" };
          break;

        default:
          result = {
            handled: false,
            action: "unknown_notification_type",
            notificationType,
          };
      }
    } catch (err) {
      console.error(
        `[Apple Webhook] Error processing ${notificationType}:`,
        err
      );
      processingError = err;
      result = {
        handled: false,
        error: err.message,
      };
    }

    // Update notification status based on result
    const finalPayload = {
      subtype,
      version,
      signedDate,
      transactionId: txInfo.transactionId,
      originalTransactionId: txInfo.originalTransactionId,
      productId: txInfo.productId,
      subscriptionId: subscription?.id,
      userId,
      result,
    };

    if (processingError) {
      // Processing failed - update status to 'failed' and move to DLQ
      await updateNotificationStatus(notificationUUID, "failed", finalPayload);
      await moveToDeadLetterQueue(
        { notificationType, notificationUUID },
        processingError,
        signedPayload
      );

      return {
        success: false,
        notificationType,
        subtype,
        notificationUUID,
        error: processingError.message,
        movedToDLQ: true,
      };
    }

    // Processing succeeded - update status to 'completed'
    await updateNotificationStatus(notificationUUID, "completed", finalPayload);

    return {
      success: true,
      notificationType,
      subtype,
      notificationUUID,
      subscriptionId: subscription?.id,
      userId,
      result,
    };
  }

  /**
   * Handle SUBSCRIBED notification (new subscription or resubscribe)
   */
  async function handleSubscribed(subscription, userId, txInfo, subtype) {
    // For new subscriptions, we need to find the user via the app's receipt validation
    // The webhook may arrive before or after the app calls our receipt endpoint
    if (!userId) {
      // Log and defer - the app should call our receipt endpoint
      console.log(
        "[Apple Webhook] SUBSCRIBED received but no user found for:",
        txInfo.originalTransactionId
      );
      return {
        handled: false,
        action: "deferred",
        reason: "USER_NOT_FOUND",
        subtype,
      };
    }

    // Build validation object for subscription manager
    const validation = buildValidationFromTxInfo(txInfo);

    const result = await subscriptionManager.syncSubscription(userId, validation);

    return {
      handled: true,
      action: subtype === NOTIFICATION_SUBTYPES.RESUBSCRIBE ? "resubscribed" : "subscribed",
      subscriptionId: result.subscriptionId,
      tier: result.tier,
      songsGranted: result.songsGranted,
    };
  }

  /**
   * Handle DID_RENEW notification
   */
  async function handleRenewal(subscription, userId, txInfo) {
    if (!subscription || !userId) {
      console.log(
        "[Apple Webhook] DID_RENEW received but subscription not found:",
        txInfo.originalTransactionId
      );
      return {
        handled: false,
        action: "deferred",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    // Build validation for renewal
    const validation = buildValidationFromTxInfo(txInfo, { isRenewal: true });

    const result = await subscriptionManager.syncSubscription(userId, validation);

    return {
      handled: true,
      action: "renewed",
      subscriptionId: result.subscriptionId,
      songsGranted: result.songsGranted,
      isRenewal: result.isRenewal,
    };
  }

  /**
   * Handle EXPIRED notification
   */
  async function handleExpired(subscription, txInfo, subtype) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    const result = await subscriptionManager.handleExpiration(subscription.id);

    return {
      handled: true,
      action: "expired",
      subscriptionId: subscription.id,
      previousTier: result.previousTier,
      newTier: result.newTier,
      subtype,
    };
  }

  /**
   * Handle GRACE_PERIOD_EXPIRED notification
   */
  async function handleGracePeriodExpired(subscription) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    // Grace period ended without successful renewal - expire the subscription
    const result = await subscriptionManager.handleExpiration(subscription.id);

    return {
      handled: true,
      action: "grace_period_expired",
      subscriptionId: subscription.id,
      previousTier: result.previousTier,
      newTier: result.newTier,
    };
  }

  /**
   * Handle DID_FAIL_TO_RENEW notification (billing retry or grace period)
   */
  async function handleFailedRenewal(subscription, txInfo, subtype) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    if (subtype === NOTIFICATION_SUBTYPES.GRACE_PERIOD) {
      // Enter grace period - keep tier but mark subscription
      const gracePeriodExpiresAt = txInfo.expiresDate || new Date(Date.now() + 16 * 24 * 60 * 60 * 1000);
      await subscriptionManager.handleGracePeriod(
        subscription.id,
        gracePeriodExpiresAt
      );

      return {
        handled: true,
        action: "grace_period_started",
        subscriptionId: subscription.id,
        gracePeriodExpiresAt,
      };
    }

    // Billing retry without grace period
    await query(
      `UPDATE subscriptions SET
         status = 'billing_retry',
         is_in_billing_retry = 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [subscription.id]
    );

    return {
      handled: true,
      action: "billing_retry_started",
      subscriptionId: subscription.id,
    };
  }

  /**
   * Handle REFUND notification
   */
  async function handleRefund(subscription, txInfo) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    const result = await subscriptionManager.handleRevocation(subscription.id);

    return {
      handled: true,
      action: "refunded",
      subscriptionId: subscription.id,
      songsRevoked: result.songsRevoked,
      refundedTransactionId: txInfo.transactionId,
    };
  }

  /**
   * Handle REVOKE notification (family sharing revoked)
   */
  async function handleRevoke(subscription, txInfo) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    const result = await subscriptionManager.handleRevocation(subscription.id);

    return {
      handled: true,
      action: "revoked",
      subscriptionId: subscription.id,
      songsRevoked: result.songsRevoked,
      revocationDate: txInfo.revocationDate,
      revocationReason: txInfo.revocationReason,
    };
  }

  /**
   * Handle DID_CHANGE_RENEWAL_PREF (upgrade/downgrade)
   */
  async function handleRenewalPrefChange(subscription, txInfo) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    // Record the pending change - actual tier change happens at next renewal
    await query(
      `UPDATE subscriptions SET
         pending_product_id = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [txInfo.autoRenewProductId, subscription.id]
    );

    return {
      handled: true,
      action: "renewal_pref_changed",
      subscriptionId: subscription.id,
      newProductId: txInfo.autoRenewProductId,
    };
  }

  /**
   * Handle DID_CHANGE_RENEWAL_STATUS (auto-renew toggled)
   */
  async function handleRenewalStatusChange(subscription, txInfo, subtype) {
    if (!subscription) {
      return {
        handled: false,
        action: "skipped",
        reason: "SUBSCRIPTION_NOT_FOUND",
      };
    }

    const autoRenewEnabled =
      subtype === NOTIFICATION_SUBTYPES.AUTO_RENEW_ENABLED;

    await query(
      `UPDATE subscriptions SET
         auto_renew_enabled = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [autoRenewEnabled ? 1 : 0, subscription.id]
    );

    return {
      handled: true,
      action: autoRenewEnabled ? "auto_renew_enabled" : "auto_renew_disabled",
      subscriptionId: subscription.id,
    };
  }

  /**
   * Build a validation object from transaction info
   * This creates the format expected by subscriptionManager.syncSubscription
   */
  function buildValidationFromTxInfo(txInfo, options = {}) {
    return {
      valid: true,
      type: "subscription",
      platform: "apple",
      transactionId: txInfo.transactionId,
      originalTransactionId: txInfo.originalTransactionId,
      productId: txInfo.productId,
      status: "active",
      isActive: true,
      isExpired: false,
      isRevoked: false,
      isInGracePeriod: false,
      isInBillingRetry: false,
      purchaseDate: txInfo.purchaseDate,
      originalPurchaseDate: txInfo.purchaseDate,
      expiresAt: txInfo.expiresDate,
      gracePeriodExpiresAt: null,
      autoRenewEnabled: txInfo.autoRenewStatus === 1,
      isTrialPeriod: false,
      environment: "production",
      ...options,
    };
  }

  /**
   * Get webhook processing statistics
   */
  async function getStats() {
    const result = await query(`
      SELECT
        notification_type,
        COUNT(*) as count,
        MIN(created_at) as first_received,
        MAX(created_at) as last_received
      FROM webhook_notifications
      WHERE platform = 'apple'
      GROUP BY notification_type
      ORDER BY count DESC
    `);

    return {
      platform: "apple",
      byType: result.rows,
      total: result.rows.reduce((sum, row) => sum + row.count, 0),
    };
  }

  return {
    processNotification,
    isNotificationProcessed,
    getStats,
    // Export for testing
    decodeNotification,
    extractTransactionInfo,
    NOTIFICATION_TYPES,
    NOTIFICATION_SUBTYPES,
  };
}

module.exports = {
  createAppleWebhookHandler,
  NOTIFICATION_TYPES,
  NOTIFICATION_SUBTYPES,
};
