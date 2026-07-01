/**
 * Subscription Sync Job - Verifies subscription status and grants renewal songs
 *
 * This job catches subscriptions that may have missed webhook notifications:
 * 1. Finds active subscriptions past their renewal date
 * 2. Verifies current status with Apple/Google
 * 3. Syncs subscription state and grants songs for renewals
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const {
  createSubscriptionSyncRepository,
} = require("../database/subscription-sync-repository");

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
  googleValidator,
  repository = null,
}) {
  const errors = [];
  let processed = 0;
  let renewed = 0;
  let expired = 0;

  const now = new Date().toISOString();
  const BATCH_SIZE = 100;
  const subscriptionSyncRepository =
    repository || createSubscriptionSyncRepository(db);

  try {
    // H6: Cursor-based pagination to avoid OFFSET drift.
    // OFFSET can skip rows when processed subscriptions change status mid-batch,
    // shifting unprocessed rows into already-scanned positions.
    let cursor = "";
    let batchCount;

    console.log(`[SubscriptionSync] Processing subscriptions (batch size: ${BATCH_SIZE})`);

    do {
      const pendingSubscriptions =
        await subscriptionSyncRepository.listPendingRenewalSubscriptions({
          cursor,
          now,
          limit: BATCH_SIZE,
        });
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
            if (!googleValidator?.verifySubscription) {
              errors.push(`Google validator missing for subscription ${subscription.id}`);
              continue;
            }

            const purchaseToken = subscription.original_transaction_id;
            const validation = await googleValidator.verifySubscription(
              purchaseToken,
              subscription.product_id
            );

            if (!validation.valid) {
              errors.push(
                `Google verification failed for subscription ${subscription.id}: ${validation.reason || "unknown_error"}`
              );
              continue;
            }

            if (validation.status === "cancelled" || validation.status === "expired") {
              await subscriptionManager.handleExpiration(subscription.id);
              expired++;
              console.log(
                `[SubscriptionSync] Expired Google subscription ${subscription.id} for user ${subscription.user_id}`
              );
              continue;
            }

            const syncResult = await subscriptionManager.syncFromGoogle({
              userId: subscription.user_id,
              purchaseToken,
              subscriptionId: subscription.product_id,
              orderId: validation.orderId,
              tier: validation.tier,
              status: validation.status,
              expiresAt: validation.expiryTime,
              autoRenewing: validation.autoRenewing,
            });

            if (syncResult.isRenewal) {
              renewed++;
              console.log(
                `[SubscriptionSync] Renewed Google subscription ${subscription.id} for user ${subscription.user_id}, ` +
                `granted ${syncResult.songsGranted || 0} songs`
              );
            }
          }
        } catch (err) {
          const errorMsg = `Error syncing subscription ${subscription.id}: ${err.message}`;
          console.error(`[SubscriptionSync] ${errorMsg}`);
          errors.push(errorMsg);
        }
      }
    } while (batchCount === BATCH_SIZE);

    // Also check for grace period expirations
    const gracePeriodExpired =
      await subscriptionSyncRepository.listExpiredGracePeriodSubscriptions({
        now,
      });

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
  googleValidator,
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
        googleValidator,
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
