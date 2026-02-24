/**
 * Subscription Manager Service
 *
 * Coordinates subscription lifecycle between receipt validators,
 * plan configuration, and the database. Handles:
 * - Syncing subscriptions from validated receipts
 * - Granting songs based on subscription tier
 * - Managing free trials
 * - Handling expiration and grace periods
 * - Maintaining audit trail
 *
 * Usage:
 *   const manager = createSubscriptionManager(db, {
 *     planConfigService,
 *     appleValidator,
 *     googleValidator, // optional
 *   });
 *
 *   const result = await manager.syncSubscription(userId, receiptValidation);
 */

const crypto = require("crypto");

/**
 * Transaction types for song_transactions table
 */
const TRANSACTION_TYPES = {
  SUBSCRIPTION_GRANT: "subscription_grant",
  SUBSCRIPTION_RENEWAL: "subscription_renewal",
  TRIAL_GRANT: "trial_grant",
  SPEND: "spend",
  REFUND: "refund",
  ADMIN_GRANT: "admin_grant",
  EXPIRATION_RESET: "expiration_reset",
};

/**
 * Subscription status values
 */
const STATUS = {
  ACTIVE: "active",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  GRACE_PERIOD: "grace_period",
  BILLING_RETRY: "billing_retry",
  REVOKED: "revoked",
  PAUSED: "paused",
};

/**
 * Create a Subscription Manager instance
 * @param {Object} db - Database connection
 * @param {Object} services - Related services
 * @returns {Object} Subscription manager interface
 */
function createSubscriptionManager(db, services = {}) {
  const { planConfigService } = services;

  if (!planConfigService) {
    throw new Error("planConfigService is required");
  }

  /**
   * Sync subscription from a validated receipt
   * This is the main entry point after receipt validation
   *
   * @param {string} userId - User ID
   * @param {Object} validation - Validated receipt from Apple/Google validator
   * @returns {Promise<Object>} Updated subscription and entitlement info
   */
  async function syncSubscription(userId, validation) {
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid receipt validation");
    }

    if (validation.type !== "subscription") {
      throw new Error("Expected subscription type receipt");
    }

    // Get plan info from product ID
    const planInfo = await planConfigService.getPlanByProductId(
      validation.productId,
      validation.platform
    );

    if (!planInfo) {
      throw new Error(`Unknown product: ${validation.productId}`);
    }

    // Check if this is a new subscription or update
    const existingSubscription = await getSubscriptionByOriginalTx(
      validation.originalTransactionId
    );

    if (existingSubscription && existingSubscription.user_id !== userId) {
      throw new Error("SUBSCRIPTION_BELONGS_TO_ANOTHER_USER");
    }

    const isNewSubscription = !existingSubscription;
    const isRenewal = existingSubscription &&
      validation.transactionId !== existingSubscription.latest_transaction_id;

    // Use transaction for atomic updates
    return db.transaction(async (query) => {
      // Upsert subscription record
      const subscriptionId = existingSubscription?.id ||
        `sub_${crypto.randomBytes(12).toString("hex")}`;

      if (isNewSubscription) {
        await query(
          `INSERT INTO subscriptions (
            id, user_id, product_id, tier, status, platform,
            original_transaction_id, latest_transaction_id,
            original_purchase_date, expires_at, auto_renew_enabled,
            grace_period_expires_at, environment, renewal_count,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            subscriptionId,
            userId,
            validation.productId,
            planInfo.tier,
            mapValidationStatus(validation),
            validation.platform,
            validation.originalTransactionId,
            validation.transactionId,
            validation.originalPurchaseDate.toISOString(),
            validation.expiresAt?.toISOString() || null,
            validation.autoRenewEnabled ? 1 : 0,
            validation.gracePeriodExpiresAt?.toISOString() || null,
            validation.environment,
            0,
          ]
        );
      } else {
        await query(
          `UPDATE subscriptions SET
            product_id = ?,
            tier = ?,
            status = ?,
            latest_transaction_id = ?,
            expires_at = ?,
            auto_renew_enabled = ?,
            grace_period_expires_at = ?,
            renewal_count = renewal_count + ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            validation.productId,
            planInfo.tier,
            mapValidationStatus(validation),
            validation.transactionId,
            validation.expiresAt?.toISOString() || null,
            validation.autoRenewEnabled ? 1 : 0,
            validation.gracePeriodExpiresAt?.toISOString() || null,
            isRenewal ? 1 : 0,
            subscriptionId,
          ]
        );
      }

      // Record the purchase receipt
      await recordPurchaseReceipt(query, userId, subscriptionId, validation);

      // Update entitlements
      const entitlementResult = await updateEntitlements(
        query,
        userId,
        planInfo,
        validation,
        isNewSubscription,
        isRenewal,
        subscriptionId
      );

      return {
        subscriptionId,
        isNewSubscription,
        isRenewal,
        tier: entitlementResult.tier,
        songsGranted: entitlementResult.songsGranted,
        songsRemaining: entitlementResult.songsRemaining,
        expiresAt: validation.expiresAt,
        status: mapValidationStatus(validation),
      };
    });
  }

  /**
   * Record purchase receipt for audit trail
   */
  async function recordPurchaseReceipt(query, userId, subscriptionId, validation) {
    const receiptId = `rcpt_${crypto.randomBytes(12).toString("hex")}`;

    await query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, verification_status, purchase_date, expires_date,
        is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(transaction_id) DO UPDATE SET
        verification_status = excluded.verification_status,
        expires_date = excluded.expires_date`,
      [
        receiptId,
        userId,
        subscriptionId,
        validation.transactionId,
        validation.originalTransactionId,
        validation.productId,
        validation.platform,
        "verified",
        validation.purchaseDate.toISOString(),
        validation.expiresAt?.toISOString() || null,
        validation.isTrialPeriod ? 1 : 0,
        0, // is_upgrade - would need to compare with previous subscription
      ]
    );
  }

  /**
   * Update user entitlements based on subscription
   */
  async function updateEntitlements(
    query, userId, planInfo, validation, isNew, isRenewal, subscriptionId
  ) {
    // Get current entitlements
    const currentResult = await query(
      "SELECT * FROM entitlements WHERE user_id = ?",
      [userId]
    );

    const current = currentResult.rows[0] || {
      songs_remaining: 0,
      songs_used_total: 0,
    };

    // Determine songs to grant
    let songsToGrant = 0;
    let transactionType = TRANSACTION_TYPES.SUBSCRIPTION_GRANT;
    const paidAccessActive = hasActivePaidAccess(validation);

    if (isNew && validation.isTrialPeriod) {
      // Trial - don't grant subscription songs, user should use trial songs
      songsToGrant = 0;
    } else if ((isNew || isRenewal) && paidAccessActive) {
      // New subscription or renewal - grant full monthly allowance
      songsToGrant = planInfo.songs_per_month;
      transactionType = isRenewal
        ? TRANSACTION_TYPES.SUBSCRIPTION_RENEWAL
        : TRANSACTION_TYPES.SUBSCRIPTION_GRANT;
    }

    const newBalance = current.songs_remaining + songsToGrant;
    const entitlementTier = paidAccessActive ? planInfo.tier : "free";
    const songsAllowance = paidAccessActive ? planInfo.songs_per_month : 0;
    const planId = paidAccessActive ? planInfo.plan_id : null;
    const billingPeriod = paidAccessActive ? getBillingPeriod(validation.productId) : null;
    const subscriptionStartsAt = paidAccessActive
      ? validation.originalPurchaseDate.toISOString()
      : null;
    const subscriptionRenewsAt = paidAccessActive
      ? validation.expiresAt?.toISOString() || null
      : null;

    // Upsert entitlements
    await query(
      `INSERT INTO entitlements (
        user_id, tier, songs_remaining, songs_allowance, songs_used_total,
        credits_balance, credits_used_total, preview_count_today,
        plan_id, billing_period, subscription_starts_at, subscription_renews_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        tier = excluded.tier,
        songs_remaining = excluded.songs_remaining,
        songs_allowance = excluded.songs_allowance,
        plan_id = excluded.plan_id,
        billing_period = excluded.billing_period,
        subscription_starts_at = CASE
          WHEN excluded.tier = 'free' THEN NULL
          ELSE COALESCE(entitlements.subscription_starts_at, excluded.subscription_starts_at)
        END,
        subscription_renews_at = excluded.subscription_renews_at,
        updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        entitlementTier,
        newBalance,
        songsAllowance,
        current.songs_used_total,
        newBalance, // Keep credits_balance in sync for backward compatibility
        current.songs_used_total,
        current.preview_count_today || 0,
        planId,
        billingPeriod,
        subscriptionStartsAt,
        subscriptionRenewsAt,
      ]
    );

    // Record transaction in audit log
    if (songsToGrant > 0) {
      await recordSongTransaction(
        query,
        userId,
        transactionType,
        songsToGrant,
        current.songs_remaining,
        newBalance,
        "subscription",
        subscriptionId,
        `${planInfo.tier} subscription ${isRenewal ? "renewal" : "started"}`
      );
    }

    return {
      tier: entitlementTier,
      songsGranted: songsToGrant,
      songsRemaining: newBalance,
    };
  }

  /**
   * Activate free trial for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Trial activation result
   */
  async function activateTrial(userId) {
    // Get trial config
    const trialConfig = await planConfigService.getTrialConfig();

    if (!trialConfig.is_active) {
      throw new Error("Free trial is currently disabled");
    }

    // Check if user already had a trial
    const existingResult = await db.query(
      "SELECT trial_started_at FROM entitlements WHERE user_id = ?",
      [userId]
    );

    if (existingResult.rows[0]?.trial_started_at) {
      throw new Error("User has already used their free trial");
    }

    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + trialConfig.duration_days);

    return db.transaction(async (query) => {
      // Get current entitlements
      const currentResult = await query(
        "SELECT songs_remaining, trial_songs_remaining FROM entitlements WHERE user_id = ?",
        [userId]
      );

      const currentSongs = currentResult.rows[0]?.songs_remaining || 0;
      const currentTrialSongs = currentResult.rows[0]?.trial_songs_remaining || 0;
      // Total available = subscription songs + trial songs
      const totalAfter = currentSongs + trialConfig.songs_allowed;

      // Upsert entitlements with trial
      // IMPORTANT: Trial songs go ONLY into trial_songs_remaining, NOT songs_remaining
      // getEntitlements() computes total as songs_remaining + trial_songs_remaining
      await query(
        `INSERT INTO entitlements (
          user_id, tier, songs_remaining, songs_allowance, songs_used_total,
          credits_balance, credits_used_total, preview_count_today,
          trial_songs_remaining, trial_expires_at, trial_started_at,
          updated_at
        ) VALUES (?, 'free', 0, 0, 0, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          trial_songs_remaining = ?,
          trial_expires_at = ?,
          trial_started_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP`,
        [
          userId,
          trialConfig.songs_allowed,
          trialExpiresAt.toISOString(),
          trialConfig.songs_allowed,
          trialExpiresAt.toISOString(),
        ]
      );

      // Record transaction
      await recordSongTransaction(
        query,
        userId,
        TRANSACTION_TYPES.TRIAL_GRANT,
        trialConfig.songs_allowed,
        currentTrialSongs,
        trialConfig.songs_allowed,
        "trial",
        null,
        `${trialConfig.duration_days}-day free trial activated`
      );

      return {
        songsGranted: trialConfig.songs_allowed,
        songsRemaining: totalAfter,
        trialExpiresAt,
        durationDays: trialConfig.duration_days,
      };
    });
  }

  /**
   * Handle subscription expiration
   * @param {string} subscriptionId - Subscription ID
   */
  async function handleExpiration(subscriptionId) {
    const subResult = await db.query(
      "SELECT * FROM subscriptions WHERE id = ?",
      [subscriptionId]
    );

    if (subResult.rows.length === 0) {
      throw new Error("Subscription not found");
    }

    const subscription = subResult.rows[0];

    return db.transaction(async (query) => {
      // Update subscription status
      await query(
        `UPDATE subscriptions SET
          status = 'expired',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [subscriptionId]
      );

      // Get current entitlements
      const entResult = await query(
        "SELECT * FROM entitlements WHERE user_id = ?",
        [subscription.user_id]
      );

      const current = entResult.rows[0];
      if (!current) return;

      // Reset to free tier but keep unused songs
      await query(
        `UPDATE entitlements SET
          tier = 'free',
          songs_allowance = 0,
          plan_id = NULL,
          billing_period = NULL,
          subscription_renews_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [subscription.user_id]
      );

      // Record audit
      await recordSongTransaction(
        query,
        subscription.user_id,
        TRANSACTION_TYPES.EXPIRATION_RESET,
        0,
        current.songs_remaining,
        current.songs_remaining, // Keep balance
        "subscription",
        subscriptionId,
        "Subscription expired, downgraded to free tier"
      );

      return {
        userId: subscription.user_id,
        previousTier: subscription.tier,
        newTier: "free",
        songsRemaining: current.songs_remaining,
      };
    });
  }

  /**
   * Handle subscription entering grace period
   * @param {string} subscriptionId - Subscription ID
   * @param {Date} gracePeriodExpiresAt - When grace period ends
   */
  async function handleGracePeriod(subscriptionId, gracePeriodExpiresAt) {
    await db.query(
      `UPDATE subscriptions SET
        status = 'grace_period',
        grace_period_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [gracePeriodExpiresAt.toISOString(), subscriptionId]
    );

    return { subscriptionId, status: "grace_period", gracePeriodExpiresAt };
  }

  /**
   * Handle subscription revocation (refund)
   * @param {string} subscriptionId - Subscription ID
   */
  async function handleRevocation(subscriptionId) {
    const subResult = await db.query(
      "SELECT * FROM subscriptions WHERE id = ?",
      [subscriptionId]
    );

    if (subResult.rows.length === 0) {
      throw new Error("Subscription not found");
    }

    const subscription = subResult.rows[0];

    return db.transaction(async (query) => {
      // Update subscription status
      await query(
        `UPDATE subscriptions SET
          status = 'revoked',
          cancelled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [subscriptionId]
      );

      // Get current entitlements
      const entResult = await query(
        "SELECT * FROM entitlements WHERE user_id = ?",
        [subscription.user_id]
      );

      const current = entResult.rows[0];
      if (!current) return;

      // Revoke granted songs for current period
      // For simplicity, we reset to 0 songs (could be more nuanced)
      const songsToRevoke = Math.min(
        current.songs_remaining,
        current.songs_allowance || 0
      );
      const newBalance = Math.max(0, current.songs_remaining - songsToRevoke);

      await query(
        `UPDATE entitlements SET
          tier = 'free',
          songs_remaining = ?,
          songs_allowance = 0,
          credits_balance = ?,
          plan_id = NULL,
          billing_period = NULL,
          subscription_renews_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [newBalance, newBalance, subscription.user_id]
      );

      // Record refund transaction
      if (songsToRevoke > 0) {
        await recordSongTransaction(
          query,
          subscription.user_id,
          TRANSACTION_TYPES.REFUND,
          -songsToRevoke,
          current.songs_remaining,
          newBalance,
          "subscription",
          subscriptionId,
          "Subscription revoked/refunded"
        );
      }

      return {
        userId: subscription.user_id,
        songsRevoked: songsToRevoke,
        songsRemaining: newBalance,
      };
    });
  }

  /**
   * Spend a song (when creating a full render)
   * @param {string} userId - User ID
   * @param {string} trackId - Track ID for reference
   * @returns {Promise<Object>} Updated balance
   */
  async function spendSong(userId, trackId) {
    return db.transaction(async (query) => spendSongInTransaction(query, userId, trackId));
  }

  async function spendSongInTransaction(query, userId, trackId) {
    const entResult = await query(
      "SELECT * FROM entitlements WHERE user_id = ?",
      [userId]
    );

    if (entResult.rows.length === 0) {
      throw new Error("No entitlements found for user");
    }

    const current = entResult.rows[0];

    // Check balance (allow using trial songs first)
    const hasTrialSongs = (current.trial_songs_remaining || 0) > 0;
    const hasRegularSongs = current.songs_remaining > 0;

    if (!hasTrialSongs && !hasRegularSongs) {
      throw new Error("Insufficient songs remaining");
    }

    let newBalance;
    let source;

    if (hasTrialSongs) {
      // Use trial song first
      newBalance = current.trial_songs_remaining - 1;
      source = "trial";

      await query(
        `UPDATE entitlements SET
          trial_songs_remaining = ?,
          songs_used_total = songs_used_total + 1,
          credits_used_total = credits_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [newBalance, userId]
      );
    } else {
      // Use regular song
      newBalance = current.songs_remaining - 1;
      source = "subscription";

      await query(
        `UPDATE entitlements SET
          songs_remaining = ?,
          credits_balance = ?,
          songs_used_total = songs_used_total + 1,
          credits_used_total = credits_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [newBalance, newBalance, userId]
      );
    }

    // Record transaction
    await recordSongTransaction(
      query,
      userId,
      TRANSACTION_TYPES.SPEND,
      -1,
      source === "trial" ? current.trial_songs_remaining : current.songs_remaining,
      newBalance,
      "track",
      trackId,
      `Song rendered from ${source}`
    );

    return {
      songsRemaining: source === "trial"
        ? newBalance + (current.songs_remaining || 0)
        : newBalance + (current.trial_songs_remaining || 0),
      source,
    };
  }

  /**
   * Get subscription by original transaction ID
   */
  async function getSubscriptionByOriginalTx(originalTransactionId) {
    const result = await db.query(
      "SELECT * FROM subscriptions WHERE original_transaction_id = ?",
      [originalTransactionId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get user's active subscription
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Active subscription or null
   */
  async function getActiveSubscription(userId) {
    const result = await db.prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'grace_period', 'billing_retry')
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(userId);
    return result || null;
  }

  /**
   * Get user entitlements
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Entitlements or null
   */
  async function getEntitlements(userId) {
    const ent = await db.prepare(
      "SELECT * FROM entitlements WHERE user_id = ?"
    ).get(userId);

    if (!ent) {
      return null;
    }

    const toSafeInt = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : fallback;
    };

    const baseSongsRemaining = toSafeInt(ent.songs_remaining);
    const trialSongsRemaining = toSafeInt(ent.trial_songs_remaining);

    return {
      userId: ent.user_id,
      tier: (typeof ent.tier === "string" && ent.tier) ? ent.tier : "free",
      songsRemaining: baseSongsRemaining + trialSongsRemaining,
      songsAllowance: toSafeInt(ent.songs_allowance),
      songsUsedTotal: toSafeInt(ent.songs_used_total),
      trialSongsRemaining,
      trialExpiresAt: ent.trial_expires_at ? new Date(ent.trial_expires_at) : null,
      previewCountToday: toSafeInt(ent.preview_count_today),
      planId: ent.plan_id || null,
      billingPeriod: ent.billing_period || null,
      subscriptionStartsAt: ent.subscription_starts_at
        ? new Date(ent.subscription_starts_at)
        : null,
      subscriptionRenewsAt: ent.subscription_renews_at
        ? new Date(ent.subscription_renews_at)
        : null,
    };
  }

  /**
   * Grant songs to user (admin function)
   * @param {string} userId - User ID
   * @param {number} amount - Number of songs to grant
   * @param {string} reason - Reason for grant
   */
  async function adminGrantSongs(userId, amount, reason) {
    return db.transaction(async (query) => {
      const entResult = await query(
        "SELECT songs_remaining FROM entitlements WHERE user_id = ?",
        [userId]
      );

      const currentBalance = entResult.rows[0]?.songs_remaining || 0;
      const newBalance = currentBalance + amount;

      await query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, credits_balance, updated_at)
         VALUES (?, 'free', ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           songs_remaining = entitlements.songs_remaining + ?,
           credits_balance = entitlements.credits_balance + ?,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, amount, amount, amount, amount]
      );

      await recordSongTransaction(
        query,
        userId,
        TRANSACTION_TYPES.ADMIN_GRANT,
        amount,
        currentBalance,
        newBalance,
        "admin",
        null,
        reason
      );

      return { songsGranted: amount, songsRemaining: newBalance };
    });
  }

  /**
   * Record a song transaction for audit trail
   */
  async function recordSongTransaction(
    query, userId, type, amount, balanceBefore, balanceAfter, source, referenceId, description
  ) {
    const txId = `stx_${crypto.randomBytes(12).toString("hex")}`;

    await query(
      `INSERT INTO song_transactions (
        id, user_id, type, amount, balance_before, balance_after,
        source, reference_type, reference_id, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        txId,
        userId,
        type,
        amount,
        balanceBefore,
        balanceAfter,
        source,
        source, // reference_type same as source for now
        referenceId,
        description,
      ]
    );

    return txId;
  }

  /**
   * Sync subscription from Google Play validation
   * Maps Google's subscription format to internal format and upserts subscription record
   *
   * @param {Object} params - Google subscription params
   * @param {string} params.userId - User ID
   * @param {string} params.purchaseToken - Google Play purchase token
   * @param {string} params.subscriptionId - Google Play subscription product ID
   * @param {string} params.orderId - Google order ID
   * @param {string} params.tier - Subscription tier (basic, premium)
   * @param {string} params.status - Subscription status
   * @param {string} params.expiresAt - Expiry timestamp
   * @param {boolean} params.autoRenewing - Auto-renewal status
   * @returns {Promise<Object>} Updated subscription info
   */
  async function syncFromGoogle({
    userId,
    purchaseToken,
    subscriptionId,
    orderId,
    tier,
    status,
    expiresAt,
    autoRenewing,
  }) {
    // Check if this is a new subscription or update
    const existingResult = await db.query(
      "SELECT * FROM subscriptions WHERE original_transaction_id = ? AND platform = 'google'",
      [purchaseToken]
    );
    const existingSubscription = existingResult.rows[0];
    const isNewSubscription = !existingSubscription;

    // Security check: Verify subscription ownership before allowing updates
    if (existingSubscription && existingSubscription.user_id !== userId) {
      throw new Error("SUBSCRIPTION_BELONGS_TO_ANOTHER_USER");
    }

    // Get plan info from product ID
    const planInfo = await planConfigService.getPlanByProductId(subscriptionId, "google");
    const resolvedTier = planInfo?.tier || tier || "premium";

    // Map Google status to internal status
    const internalStatus = mapGoogleStatus(status);

    // Use transaction for atomic updates
    return db.transaction(async (query) => {
      const subscriptionDbId = existingSubscription?.id ||
        `sub_${crypto.randomBytes(12).toString("hex")}`;

      if (isNewSubscription) {
        await query(
          `INSERT INTO subscriptions (
            id, user_id, product_id, tier, status, platform,
            original_transaction_id, latest_transaction_id,
            original_purchase_date, expires_at, auto_renew_enabled,
            environment, renewal_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'google', ?, ?, CURRENT_TIMESTAMP, ?, ?, 'production', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            subscriptionDbId,
            userId,
            subscriptionId,
            resolvedTier,
            internalStatus,
            purchaseToken,
            orderId,
            expiresAt || null,
            autoRenewing ? 1 : 0,
          ]
        );

        // Grant songs for new subscription
        if (planInfo && (internalStatus === STATUS.ACTIVE || internalStatus === STATUS.GRACE_PERIOD)) {
          const songsToGrant = planInfo.songs_per_month || 0;
          if (songsToGrant > 0) {
            await query(
              `INSERT INTO entitlements (user_id, tier, songs_remaining, songs_allowance, songs_used_total, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id) DO UPDATE SET
                 tier = excluded.tier,
                 songs_remaining = songs_remaining + ?,
                 songs_allowance = excluded.songs_allowance,
                 updated_at = CURRENT_TIMESTAMP`,
              [userId, resolvedTier, songsToGrant, songsToGrant, songsToGrant]
            );
          }
        }
      } else {
        await query(
          `UPDATE subscriptions SET
            product_id = ?,
            tier = ?,
            status = ?,
            latest_transaction_id = ?,
            expires_at = ?,
            auto_renew_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            subscriptionId,
            resolvedTier,
            internalStatus,
            orderId,
            expiresAt || null,
            autoRenewing ? 1 : 0,
            subscriptionDbId,
          ]
        );
      }

      return {
        id: subscriptionDbId,
        tier: resolvedTier,
        status: internalStatus,
        expires_at: expiresAt,
        auto_renewing: autoRenewing,
        is_new: isNewSubscription,
      };
    });
  }

  /**
   * Map Google subscription status to internal status
   */
  function mapGoogleStatus(googleStatus) {
    switch (googleStatus) {
      case "active":
        return STATUS.ACTIVE;
      case "grace_period":
        return STATUS.GRACE_PERIOD;
      case "on_hold":
        return STATUS.BILLING_RETRY;
      case "cancelled":
      case "expired":
        return STATUS.EXPIRED;
      case "paused":
        return STATUS.PAUSED;
      default:
        return STATUS.EXPIRED;
    }
  }

  /**
   * Map validation status to our status strings
   */
  function mapValidationStatus(validation) {
    if (validation.isActive) return STATUS.ACTIVE;
    if (validation.isInGracePeriod) return STATUS.GRACE_PERIOD;
    if (validation.isInBillingRetry) return STATUS.BILLING_RETRY;
    if (validation.isRevoked) return STATUS.REVOKED;
    if (validation.isExpired) return STATUS.EXPIRED;
    return STATUS.EXPIRED;
  }

  function hasActivePaidAccess(validation) {
    return Boolean(
      validation?.isActive ||
      validation?.isInGracePeriod ||
      validation?.isInBillingRetry
    );
  }

  /**
   * Extract billing period from product ID
   */
  function getBillingPeriod(productId) {
    if (productId.includes("annual") || productId.includes("yearly")) {
      return "annual";
    }
    return "monthly";
  }

  return {
    // Main subscription operations
    syncSubscription,
    syncFromGoogle,
    activateTrial,
    handleExpiration,
    handleGracePeriod,
    handleRevocation,

    // Song management
    spendSong,
    spendSongInTransaction,
    adminGrantSongs,

    // Queries
    getActiveSubscription,
    getSubscriptionByOriginalTx,
    getEntitlements,

    // Constants
    TRANSACTION_TYPES,
    STATUS,
  };
}

module.exports = {
  createSubscriptionManager,
  TRANSACTION_TYPES,
  STATUS,
};
