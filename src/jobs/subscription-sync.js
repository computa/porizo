/**
 * Subscription Sync Job - Verifies subscription status and grants renewal songs
 *
 * This job catches subscriptions that may have missed webhook notifications:
 * 1. Finds active subscriptions past their renewal date
 * 2. Verifies current status with Apple/Google
 * 3. Syncs subscription state and grants songs for renewals
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Sync subscriptions that may need renewal verification
 * @param {Object} options
 * @param {Object} options.db - Database instance
 * @param {Object} options.subscriptionManager - Subscription manager service
 * @param {Object} options.appleValidator - Apple receipt validator service
 * @returns {Promise<{processed: number, renewed: number, expired: number, errors: string[]}>}
 */
async function syncPendingRenewals({
  db,
  subscriptionManager,
  appleValidator,
}) {
  const errors = [];
  let processed = 0;
  let renewed = 0;
  let expired = 0;

  const now = new Date().toISOString();

  try {
    // Find subscriptions that are:
    // 1. Active or in grace period
    // 2. Past their renewal/expiry date (potential missed webhook)
    // 3. Have auto-renew enabled (expecting renewal)
    const stmt = await db.prepare(`
      SELECT s.*, e.subscription_renews_at
      FROM subscriptions s
      LEFT JOIN entitlements e ON e.user_id = s.user_id
      WHERE s.status IN ('active', 'grace_period')
        AND s.auto_renew_enabled = 1
        AND (
          (s.expires_at IS NOT NULL AND s.expires_at < ?)
          OR (e.subscription_renews_at IS NOT NULL AND e.subscription_renews_at < ?)
        )
      LIMIT 100
    `);

    const pendingSubscriptions = stmt.all(now, now);

    console.log(`[SubscriptionSync] Found ${pendingSubscriptions.length} subscriptions to verify`);

    for (const subscription of pendingSubscriptions) {
      processed++;

      try {
        if (subscription.platform === "apple") {
          // Verify with Apple
          const status = await appleValidator.getSubscriptionStatus(
            subscription.original_transaction_id
          );

          if (status.isActive) {
            // Subscription is still active - sync it (may grant songs)
            const syncResult = await subscriptionManager.syncSubscription(
              subscription.user_id,
              {
                transactionId: status.transactionId,
                originalTransactionId: subscription.original_transaction_id,
                productId: status.productId || subscription.product_id,
                platform: "apple",
                originalPurchaseDate: new Date(subscription.original_purchase_date),
                expiresAt: status.expiresAt,
                autoRenewEnabled: status.autoRenewStatus,
                isInBillingRetry: status.isInBillingRetry,
                gracePeriodExpiresAt: status.gracePeriodExpiresAt,
                isTrial: false,
                environment: subscription.environment || "production",
              }
            );

            if (syncResult.isRenewal) {
              renewed++;
              console.log(
                `[SubscriptionSync] Renewed subscription ${subscription.id} for user ${subscription.user_id}, ` +
                `granted ${syncResult.songsGranted} songs`
              );
            }
          } else {
            // Subscription expired or was cancelled
            await subscriptionManager.handleExpiration(subscription.id);
            expired++;
            console.log(
              `[SubscriptionSync] Expired subscription ${subscription.id} for user ${subscription.user_id}`
            );
          }
        } else if (subscription.platform === "google") {
          // TODO: Implement Google Play verification when googleValidator is added
          console.log(`[SubscriptionSync] Skipping Google subscription ${subscription.id} (not implemented)`);
        }
      } catch (err) {
        const errorMsg = `Error syncing subscription ${subscription.id}: ${err.message}`;
        console.error(`[SubscriptionSync] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    // Also check for grace period expirations
    const gracePeriodExpired = await db.prepare(`
      SELECT id FROM subscriptions
      WHERE status = 'grace_period'
        AND grace_period_expires_at IS NOT NULL
        AND grace_period_expires_at < ?
    `).all(now);

    for (const sub of gracePeriodExpired) {
      try {
        await subscriptionManager.handleExpiration(sub.id);
        expired++;
        console.log(`[SubscriptionSync] Grace period expired for subscription ${sub.id}`);
      } catch (err) {
        errors.push(`Error expiring grace period for ${sub.id}: ${err.message}`);
      }
    }

    return { processed, renewed, expired, errors };
  } catch (err) {
    console.error("[SubscriptionSync] Job failed:", err);
    errors.push(`Job failed: ${err.message}`);
    return { processed, renewed, expired, errors };
  }
}

/**
 * Start the subscription sync job
 * @param {Object} options
 * @param {Object} options.db - Database instance
 * @param {Object} options.subscriptionManager - Subscription manager service
 * @param {Object} options.appleValidator - Apple receipt validator service
 * @param {number} options.intervalMs - Interval between job runs (default: 1 hour)
 * @returns {{tick: Function, stop: Function}} Job controller
 */
function startSubscriptionSyncJob({
  db,
  subscriptionManager,
  appleValidator,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) {
      console.log("[SubscriptionSync] Previous run still in progress, skipping");
      return;
    }

    isRunning = true;
    try {
      const result = await syncPendingRenewals({
        db,
        subscriptionManager,
        appleValidator,
      });

      if (result.processed > 0) {
        console.log(
          `[SubscriptionSync] Completed: ${result.processed} processed, ` +
          `${result.renewed} renewed, ${result.expired} expired, ${result.errors.length} errors`
        );
      }
    } catch (err) {
      console.error("[SubscriptionSync] Unhandled error:", err);
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(tick, intervalMs);

  // Run immediately on start
  tick();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  syncPendingRenewals,
  startSubscriptionSyncJob,
};
