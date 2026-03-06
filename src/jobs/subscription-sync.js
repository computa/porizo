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
  const BATCH_SIZE = 100;

  try {
    // H6: Cursor-based pagination to avoid OFFSET drift.
    // OFFSET can skip rows when processed subscriptions change status mid-batch,
    // shifting unprocessed rows into already-scanned positions.
    let cursor = "";
    let batchCount;

    console.log(`[SubscriptionSync] Processing subscriptions (batch size: ${BATCH_SIZE})`);

    do {
      const stmt = await db.prepare(`
        SELECT s.*, e.subscription_renews_at
        FROM subscriptions s
        LEFT JOIN entitlements e ON e.user_id = s.user_id
        WHERE s.status IN ('active', 'grace_period')
          AND s.auto_renew_enabled = 1
          AND s.id > ?
          AND (
            (s.expires_at IS NOT NULL AND s.expires_at < ?)
            OR (e.subscription_renews_at IS NOT NULL AND e.subscription_renews_at < ?)
          )
        ORDER BY s.id ASC
        LIMIT ?
      `);

      const pendingSubscriptions = await stmt.all(cursor, now, now, BATCH_SIZE);
      batchCount = pendingSubscriptions.length;

      for (const subscription of pendingSubscriptions) {
        processed++;
        cursor = subscription.id;

        try {
          if (subscription.platform === "apple") {
            const referenceTransactionId =
              subscription.latest_transaction_id ||
              subscription.original_transaction_id;

            if (!referenceTransactionId) {
              errors.push(
                `Subscription ${subscription.id} has no transaction identifiers for sync`
              );
              continue;
            }

            // Verify with Apple and normalize through the same contract used by receipt restore/sync.
            const validation = await appleValidator.verifyTransaction(referenceTransactionId);
            if (!validation.valid) {
              errors.push(
                `Apple verification failed for subscription ${subscription.id}: ${validation.error || "unknown_error"}`
              );
              continue;
            }

            // Guard: syncSubscription expects type === "subscription"
            if (validation.type && validation.type !== "subscription") {
              errors.push(
                `Subscription ${subscription.id} resolved to type "${validation.type}", skipping`
              );
              continue;
            }

            if (validation.isRevoked) {
              await subscriptionManager.handleRevocation(subscription.id);
              expired++;
              console.log(
                `[SubscriptionSync] Revoked subscription ${subscription.id} for user ${subscription.user_id}`
              );
              continue;
            }

            if (validation.isExpired) {
              await subscriptionManager.handleExpiration(subscription.id);
              expired++;
              console.log(
                `[SubscriptionSync] Expired subscription ${subscription.id} for user ${subscription.user_id}`
              );
              continue;
            }

            // Active/grace/billing-retry subscriptions are synced to grant renewals and refresh entitlement windows.
            const syncResult = await subscriptionManager.syncSubscription(
              subscription.user_id,
              validation
            );

            if (syncResult.isRenewal) {
              renewed++;
              console.log(
                `[SubscriptionSync] Renewed subscription ${subscription.id} for user ${subscription.user_id}, ` +
                `granted ${syncResult.songsGranted} songs`
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
    } while (batchCount === BATCH_SIZE);

    // Also check for grace period expirations
    const gracePeriodStmt = await db.prepare(`
      SELECT id FROM subscriptions
      WHERE status = 'grace_period'
        AND grace_period_expires_at IS NOT NULL
        AND grace_period_expires_at < ?
    `);
    const gracePeriodExpired = await gracePeriodStmt.all(now);

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
