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
const { getFeatureFlag } = require("./feature-flags");
const { identityHash } = require("./identity-service");

/**
 * Entitlement error codes for structured error dispatch
 */
const ENTITLEMENT_ERRORS = {
  NO_ENTITLEMENTS: "NO_ENTITLEMENTS",
  INSUFFICIENT_SONGS: "INSUFFICIENT_SONGS",
  INSUFFICIENT_POEMS: "INSUFFICIENT_POEMS",
};

/**
 * Transaction types for song_transactions table
 */
const TRANSACTION_TYPES = {
  FREE_SIGNUP_GRANT: "free_signup_grant",
  SUBSCRIPTION_GRANT: "subscription_grant",
  SUBSCRIPTION_RENEWAL: "subscription_renewal",
  TRIAL_GRANT: "trial_grant",
  SPEND: "spend",
  REFUND: "refund",
  ADMIN_GRANT: "admin_grant",
  ADMIN_UPGRADE: "admin_upgrade",
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

function buildReceiptVerificationResponse(validation) {
  const rawTransaction = validation?._raw?.transactionInfo || {};
  const payload = {
    type: validation.type || null,
    environment: validation.environment || "production",
    status: validation.status || null,
    price_millis: validation.price ?? rawTransaction.price ?? null,
    currency: validation.currency ?? rawTransaction.currency ?? null,
    storefront: validation.storefront ?? rawTransaction.storefront ?? null,
    transaction_reason: rawTransaction.transactionReason || null,
  };

  return JSON.stringify(payload);
}

/**
 * Create a Subscription Manager instance
 * @param {Object} db - Database connection
 * @param {Object} services - Related services
 * @returns {Object} Subscription manager interface
 */
function createSubscriptionManager(db, services = {}) {
  const { planConfigService, writeAuditLog } = services;

  if (!planConfigService) {
    throw new Error("planConfigService is required");
  }

  /**
   * Acquire advisory lock and return FOR UPDATE suffix for PostgreSQL.
   * SQLite serializes writes naturally so both are no-ops there.
   *
   * IMPORTANT: Postgres requires FOR UPDATE to be the LAST clause —
   * after any ORDER BY / LIMIT. Always interpolate the returned suffix
   * at the very end of the query string, not after the WHERE clause
   * when ORDER BY/LIMIT follow.
   */
  async function acquireUserLock(query, userId) {
    if (db.isPostgres) {
      await query("SELECT pg_advisory_xact_lock(hashtext(?))", [userId]);
    }
    return db.isPostgres ? " FOR UPDATE" : "";
  }

  function isAdminUpgradeActive(ent) {
    return (
      ent.admin_upgrade_tier &&
      ent.admin_upgrade_expires_at &&
      new Date(ent.admin_upgrade_expires_at) > new Date()
    );
  }

  const TIER_RANK = { free: 0, plus: 1, pro: 2 };

  /**
   * Resolve effective tier from raw entitlements row (lightweight, no full parse)
   * @param {Object} ent - Raw entitlements row
   * @returns {Promise<string>} Effective tier
   */
  async function resolveEffectiveTier(ent) {
    let subscriptionTier = "free";
    const rawTier =
      typeof ent.tier === "string" && ent.tier ? ent.tier : "free";
    if (rawTier !== "free") {
      const activeSub = await db
        .prepare(
          `SELECT id FROM subscriptions
         WHERE user_id = ? AND status IN ('active', 'grace_period', 'billing_retry')
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
        )
        .get(ent.user_id, new Date().toISOString());
      if (activeSub) {
        subscriptionTier = rawTier;
      }
    }

    const adminTier = isAdminUpgradeActive(ent)
      ? ent.admin_upgrade_tier
      : "free";

    return [subscriptionTier, adminTier].reduce(
      (best, t) => ((TIER_RANK[t] || 0) > (TIER_RANK[best] || 0) ? t : best),
      "free",
    );
  }

  /**
   * Get effective tier only (lightweight — single SELECT + optional subscription check)
   * @param {string} userId - User ID
   * @returns {Promise<string>} Effective tier ('free', 'plus', or 'pro')
   */
  async function getEffectiveTier(userId) {
    const ent = await db
      .prepare(
        "SELECT user_id, tier, admin_upgrade_tier, admin_upgrade_expires_at FROM entitlements WHERE user_id = ?",
      )
      .get(userId);
    if (!ent) return "free";
    return resolveEffectiveTier(ent);
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

    // Get plan info from product ID (safe to read outside transaction — immutable config)
    const planInfo = await planConfigService.getPlanByProductId(
      validation.productId,
      validation.platform,
    );

    if (!planInfo) {
      throw new Error(`Unknown product: ${validation.productId}`);
    }

    // All mutable state reads (subscription lookup, isRenewal) happen INSIDE the
    // transaction to prevent TOCTOU races (C4). The FOR UPDATE lock serializes
    // concurrent syncs for the same originalTransactionId (C3/M1).
    return db.transaction(async (query) => {
      const lockSuffix = await acquireUserLock(query, userId);
      const existingResult = await query(
        `SELECT * FROM subscriptions
         WHERE original_transaction_id = ?${lockSuffix}`,
        [validation.originalTransactionId],
      );
      let existingSubscription = existingResult.rows[0] || null;

      if (!existingSubscription) {
        const productResult = await query(
          `SELECT * FROM subscriptions
           WHERE user_id = ? AND product_id = ?
           ORDER BY
             CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC,
             expires_at DESC,
             created_at DESC
           LIMIT 1${lockSuffix}`,
          [userId, validation.productId],
        );
        existingSubscription = productResult.rows[0] || null;
      }

      if (existingSubscription && existingSubscription.user_id !== userId) {
        throw new Error("SUBSCRIPTION_BELONGS_TO_ANOTHER_USER");
      }

      const incomingExpiresAtMs = validation.expiresAt?.getTime?.() ?? null;
      const existingExpiresAtMs = existingSubscription?.expires_at
        ? new Date(existingSubscription.expires_at).getTime()
        : null;
      const isCompetingChain =
        existingSubscription &&
        existingSubscription.original_transaction_id &&
        existingSubscription.original_transaction_id !==
          validation.originalTransactionId;
      const shouldIgnoreStaleCompetingChain =
        isCompetingChain &&
        Number.isFinite(existingExpiresAtMs) &&
        Number.isFinite(incomingExpiresAtMs) &&
        existingExpiresAtMs > incomingExpiresAtMs;

      if (shouldIgnoreStaleCompetingChain) {
        await recordPurchaseReceipt(
          query,
          userId,
          existingSubscription.id,
          validation,
        );
        return {
          subscriptionId: existingSubscription.id,
          isNewSubscription: false,
          isRenewal: false,
          tier: existingSubscription.tier,
          songsGranted: 0,
          songsRemaining: null,
          expiresAt: existingSubscription.expires_at
            ? new Date(existingSubscription.expires_at)
            : null,
          status: existingSubscription.status,
          ignoredAsStaleCompetingChain: true,
        };
      }

      const isNewSubscription = !existingSubscription;
      const isRenewal =
        existingSubscription &&
        validation.transactionId !== existingSubscription.latest_transaction_id;

      // Upsert subscription record
      const subscriptionId =
        existingSubscription?.id ||
        `sub_${crypto.randomBytes(12).toString("hex")}`;

      if (isNewSubscription) {
        await query(
          `INSERT INTO subscriptions (
            id, user_id, product_id, tier, status, platform,
            original_transaction_id, latest_transaction_id,
            original_purchase_date, expires_at, auto_renew_enabled,
            grace_period_expires_at, environment, renewal_count,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, product_id) DO UPDATE SET
            tier = EXCLUDED.tier,
            status = EXCLUDED.status,
            platform = EXCLUDED.platform,
            original_transaction_id = EXCLUDED.original_transaction_id,
            latest_transaction_id = EXCLUDED.latest_transaction_id,
            original_purchase_date = EXCLUDED.original_purchase_date,
            expires_at = EXCLUDED.expires_at,
            auto_renew_enabled = EXCLUDED.auto_renew_enabled,
            grace_period_expires_at = EXCLUDED.grace_period_expires_at,
            environment = EXCLUDED.environment,
            renewal_count = 0,
            cancelled_at = NULL,
            updated_at = CURRENT_TIMESTAMP`,
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
          ],
        );
      } else {
        await query(
          `UPDATE subscriptions SET
            product_id = ?,
            tier = ?,
            status = ?,
            original_transaction_id = ?,
            latest_transaction_id = ?,
            original_purchase_date = ?,
            expires_at = ?,
            auto_renew_enabled = ?,
            grace_period_expires_at = ?,
            renewal_count = renewal_count + ?,
            environment = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            validation.productId,
            planInfo.tier,
            mapValidationStatus(validation),
            validation.originalTransactionId,
            validation.transactionId,
            validation.originalPurchaseDate.toISOString(),
            validation.expiresAt?.toISOString() || null,
            validation.autoRenewEnabled ? 1 : 0,
            validation.gracePeriodExpiresAt?.toISOString() || null,
            isRenewal ? 1 : 0,
            validation.environment,
            subscriptionId,
          ],
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
        subscriptionId,
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
  async function recordPurchaseReceipt(
    query,
    userId,
    subscriptionId,
    validation,
  ) {
    const receiptId = `rcpt_${crypto.randomBytes(12).toString("hex")}`;

    await query(
      `INSERT INTO purchase_receipts (
        id, user_id, subscription_id, transaction_id, original_transaction_id,
        product_id, platform, verification_status, verification_response,
        purchase_date, expires_date, is_trial, is_upgrade, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(transaction_id) DO UPDATE SET
        verification_status = excluded.verification_status,
        verification_response = excluded.verification_response,
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
        buildReceiptVerificationResponse(validation),
        validation.purchaseDate.toISOString(),
        validation.expiresAt?.toISOString() || null,
        validation.isTrialPeriod ? 1 : 0,
        0, // is_upgrade - would need to compare with previous subscription
      ],
    );
  }

  /**
   * Update user entitlements based on subscription
   */
  async function updateEntitlements(
    query,
    userId,
    planInfo,
    validation,
    isNew,
    isRenewal,
    subscriptionId,
  ) {
    // Get current entitlements
    const currentResult = await query(
      "SELECT * FROM entitlements WHERE user_id = ?",
      [userId],
    );

    const current = currentResult.rows[0] || {
      songs_remaining: 0,
      songs_used_total: 0,
      poems_remaining: 0,
    };

    // Determine songs to grant
    let songsToGrant = 0;
    let transactionType = TRANSACTION_TYPES.SUBSCRIPTION_GRANT;
    const paidAccessActive = hasActivePaidAccess(validation);

    // H3+H4: Detect plan change (upgrade/downgrade) by comparing plan_id
    const isPlanChange =
      !isNew &&
      !isRenewal &&
      paidAccessActive &&
      current.plan_id &&
      current.plan_id !== planInfo.plan_id;

    if (isNew && validation.isTrialPeriod) {
      // Trial - don't grant subscription songs, user should use trial songs
      songsToGrant = 0;
    } else if (isPlanChange) {
      // Plan change: reset to new plan's allowance instead of stacking
      songsToGrant = planInfo.songs_per_month;
      transactionType = TRANSACTION_TYPES.SUBSCRIPTION_GRANT;
    } else if ((isNew || isRenewal) && paidAccessActive) {
      // New subscription or renewal - grant full monthly allowance
      songsToGrant = planInfo.songs_per_month;
      transactionType = isRenewal
        ? TRANSACTION_TYPES.SUBSCRIPTION_RENEWAL
        : TRANSACTION_TYPES.SUBSCRIPTION_GRANT;
    }

    // On renewal or plan change, reset balance to plan allowance (credits don't carry over)
    const shouldResetBalance = isPlanChange || isRenewal;
    const newBalance = shouldResetBalance
      ? songsToGrant
      : current.songs_remaining + songsToGrant;
    const entitlementTier = paidAccessActive ? planInfo.tier : "free";
    const songsAllowance = paidAccessActive ? planInfo.songs_per_month : 0;
    const poemsAllowance = paidAccessActive ? planInfo.poems_per_month || 0 : 0;
    const poemsToGrant =
      (isNew || isRenewal || isPlanChange) && paidAccessActive
        ? poemsAllowance
        : 0;
    const newPoemsBalance = shouldResetBalance
      ? poemsToGrant
      : (current.poems_remaining || 0) + poemsToGrant;
    const planId = paidAccessActive ? planInfo.plan_id : null;
    const billingPeriod = paidAccessActive
      ? getBillingPeriod(validation.productId)
      : null;
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
        poems_remaining, poems_allowance,
        preview_count_today,
        plan_id, billing_period, subscription_starts_at, subscription_renews_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        tier = excluded.tier,
        songs_remaining = excluded.songs_remaining,
        songs_allowance = excluded.songs_allowance,
        poems_remaining = excluded.poems_remaining,
        poems_allowance = excluded.poems_allowance,
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
        newPoemsBalance,
        poemsAllowance,
        current.preview_count_today || 0,
        planId,
        billingPeriod,
        subscriptionStartsAt,
        subscriptionRenewsAt,
      ],
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
        `${planInfo.tier} subscription ${isRenewal ? "renewal" : "started"}`,
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
  async function activateTrial(userId, opts = {}) {
    // Get trial config
    const trialConfig = await planConfigService.getTrialConfig();

    if (!trialConfig.is_active) {
      throw new Error("Free trial is currently disabled");
    }

    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(
      trialExpiresAt.getDate() + trialConfig.duration_days,
    );

    return db.transaction(async (query) => {
      // C1 + review H-1/H4: All checks inside transaction to prevent TOCTOU race
      const lockSuffix = await acquireUserLock(query, userId);
      const currentResult = await query(
        `SELECT songs_remaining, trial_songs_remaining, trial_started_at, tier
         FROM entitlements WHERE user_id = ?${lockSuffix}`,
        [userId],
      );

      if (currentResult.rows[0]?.trial_started_at) {
        throw new Error("User has already used their free trial");
      }

      const currentTier = currentResult.rows[0]?.tier;
      if (currentTier && currentTier !== "free") {
        throw new Error("Cannot activate trial with an active subscription");
      }

      // Sybil tombstone + risk gate: a previously-granted identity (or a
      // high/blocked-risk user) gets a 0-song trial.
      const { suppressed, hash } = await evaluateFreeGrantGate(
        query,
        userId,
        "trial",
        opts.identity,
      );
      const songsGranted = suppressed ? 0 : trialConfig.songs_allowed;

      const currentSongs = currentResult.rows[0]?.songs_remaining || 0;
      const currentTrialSongs =
        currentResult.rows[0]?.trial_songs_remaining || 0;
      // Total available = subscription songs + trial songs
      const totalAfter = currentSongs + songsGranted;

      // Upsert entitlements with trial
      // IMPORTANT: Trial songs go ONLY into trial_songs_remaining, NOT songs_remaining
      // getEntitlements() computes total as songs_remaining + trial_songs_remaining
      await query(
        `INSERT INTO entitlements (
          user_id, tier, songs_remaining, songs_allowance, songs_used_total,
          poems_remaining, poems_allowance, poems_used_total,
          preview_count_today,
          trial_songs_remaining, trial_expires_at, trial_started_at,
          updated_at
        ) VALUES (?, 'free', 0, 0, 0, 0, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          trial_songs_remaining = ?,
          trial_expires_at = ?,
          trial_started_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP`,
        [
          userId,
          songsGranted,
          trialExpiresAt.toISOString(),
          songsGranted,
          trialExpiresAt.toISOString(),
        ],
      );

      // Record transaction (even a 0 grant marks the trial as used)
      await recordSongTransaction(
        query,
        userId,
        TRANSACTION_TYPES.TRIAL_GRANT,
        songsGranted,
        currentTrialSongs,
        songsGranted,
        "trial",
        null,
        `${trialConfig.duration_days}-day free trial activated`,
      );

      // Record the trial tombstone so the identity cannot re-farm a trial.
      if (hash && songsGranted > 0) {
        await query(
          `INSERT INTO granted_identities (identity_hash, grant_kind)
           VALUES (?, 'trial')
           ON CONFLICT (identity_hash) DO NOTHING`,
          [hash],
        );
      }

      return {
        songsGranted,
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
      [subscriptionId],
    );

    if (subResult.rows.length === 0) {
      throw new Error("Subscription not found");
    }

    const subscription = subResult.rows[0];

    return db.transaction(async (query) => {
      await acquireUserLock(query, subscription.user_id);
      // Update subscription status
      await query(
        `UPDATE subscriptions SET
          status = 'expired',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [subscriptionId],
      );

      // Get current entitlements
      const entResult = await query(
        "SELECT * FROM entitlements WHERE user_id = ?",
        [subscription.user_id],
      );

      const current = entResult.rows[0];
      if (!current) return;

      // Check if admin upgrade is still active before zeroing balances
      const adminUpgradeActive = isAdminUpgradeActive(current);

      if (adminUpgradeActive) {
        // Admin upgrade active — clear subscription fields but preserve balances
        await query(
          `UPDATE entitlements SET
            tier = 'free',
            plan_id = NULL,
            billing_period = NULL,
            subscription_renews_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?`,
          [subscription.user_id],
        );

        return {
          userId: subscription.user_id,
          previousTier: subscription.tier,
          newTier: "free",
          songsRemaining: current.songs_remaining || 0,
        };
      }

      // No admin upgrade — reset everything to free
      await query(
        `UPDATE entitlements SET
          tier = 'free',
          songs_remaining = 0,
          songs_allowance = 0,
          poems_remaining = 0,
          poems_allowance = 0,
          plan_id = NULL,
          billing_period = NULL,
          subscription_renews_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [subscription.user_id],
      );

      // Record audit (only if there were songs to expire, consistent with handleRevocation)
      const expiredSongs = current.songs_remaining || 0;
      if (expiredSongs > 0) {
        await recordSongTransaction(
          query,
          subscription.user_id,
          TRANSACTION_TYPES.EXPIRATION_RESET,
          -expiredSongs,
          expiredSongs,
          0,
          "subscription",
          subscriptionId,
          "Subscription expired, credits reset to zero",
        );
      }

      return {
        userId: subscription.user_id,
        previousTier: subscription.tier,
        newTier: "free",
        songsRemaining: 0,
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
      [gracePeriodExpiresAt.toISOString(), subscriptionId],
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
      [subscriptionId],
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
        [subscriptionId],
      );

      // Get current entitlements
      const entResult = await query(
        "SELECT * FROM entitlements WHERE user_id = ?",
        [subscription.user_id],
      );

      const current = entResult.rows[0];
      if (!current) return;

      // Check if admin upgrade is still active before full zeroing
      const adminUpgradeActive = isAdminUpgradeActive(current);

      // H5: Revoke based on cumulative granted songs, not just one period's allowance.
      // Query total songs granted via this subscription to revoke proportionally.
      const grantResult = await query(
        `SELECT COALESCE(SUM(amount), 0) AS total_granted
         FROM song_transactions
         WHERE user_id = ? AND reference_id = ?
           AND type IN (?, ?)`,
        [
          subscription.user_id,
          subscriptionId,
          TRANSACTION_TYPES.SUBSCRIPTION_GRANT,
          TRANSACTION_TYPES.SUBSCRIPTION_RENEWAL,
        ],
      );
      const totalGranted = Number(grantResult.rows[0]?.total_granted || 0);
      const songsToRevoke = Math.min(current.songs_remaining, totalGranted);
      const newBalance = Math.max(0, current.songs_remaining - songsToRevoke);

      if (adminUpgradeActive) {
        // Admin upgrade active — revoke subscription songs but preserve admin grant
        await query(
          `UPDATE entitlements SET
            tier = 'free',
            songs_remaining = ?,
            plan_id = NULL,
            billing_period = NULL,
            subscription_renews_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?`,
          [newBalance, subscription.user_id],
        );
      } else {
        // M2: Also revoke poems and reset allowances on revocation
        const poemsToRevoke = Math.min(
          current.poems_remaining || 0,
          current.poems_allowance || 0,
        );
        const newPoemsBalance = Math.max(
          0,
          (current.poems_remaining || 0) - poemsToRevoke,
        );

        await query(
          `UPDATE entitlements SET
            tier = 'free',
            songs_remaining = ?,
            songs_allowance = 0,
            poems_remaining = ?,
            poems_allowance = 0,
            plan_id = NULL,
            billing_period = NULL,
            subscription_renews_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?`,
          [newBalance, newPoemsBalance, subscription.user_id],
        );
      }

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
          "Subscription revoked/refunded",
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
    return db.transaction(async (query) =>
      spendSongInTransaction(query, userId, trackId),
    );
  }

  async function spendSongInTransaction(
    query,
    userId,
    trackId,
    trackVersionId = null,
  ) {
    // Read current state to determine source (trial vs regular) and validate expiry.
    // The actual decrement is done atomically via UPDATE...WHERE to eliminate the
    // SELECT-then-UPDATE race (BILL-02). SQLite is single-writer so the WHERE check
    // is race-free there; on PostgreSQL the row-level lock taken by each atomic
    // UPDATE...WHERE <col> > 0 serializes concurrent spends for the same user.
    // NOTE: there is NO advisory lock on this path — the atomic WHERE guard is the
    // sole double-spend protection, and it is sufficient for trial, subscription,
    // and gift_wallet decrements alike.
    const entResult = await query(
      "SELECT * FROM entitlements WHERE user_id = ?",
      [userId],
    );

    if (entResult.rows.length === 0) {
      const err = new Error("No entitlements found for user");
      err.code = ENTITLEMENT_ERRORS.NO_ENTITLEMENTS;
      throw err;
    }

    const current = entResult.rows[0];

    // H1: Check trial expiry before allowing trial song spend
    const trialExpired =
      current.trial_expires_at &&
      new Date(current.trial_expires_at) < new Date();
    const hasTrialSongs =
      !trialExpired && (current.trial_songs_remaining || 0) > 0;
    const hasRegularSongs = current.songs_remaining > 0;

    // BILL-GIFT: One-off gift_wallet tokens (bundles) are spendable on
    // make-your-own once subscription + trial credits are exhausted. Pay-per-song
    // is a permanent product, so no feature flag gates this. Only read the wallet
    // balance when it would actually be needed (no trial/regular songs left).
    let giftWalletBalance = 0;
    if (!hasTrialSongs && !hasRegularSongs) {
      const walletResult = await query(
        "SELECT balance FROM gift_wallet WHERE user_id = ?",
        [userId],
      );
      giftWalletBalance = Number(walletResult.rows?.[0]?.balance || 0);
    }
    const hasGiftTokens = giftWalletBalance > 0;

    if (!hasTrialSongs && !hasRegularSongs && !hasGiftTokens) {
      const err = new Error("Insufficient songs remaining");
      err.code = ENTITLEMENT_ERRORS.INSUFFICIENT_SONGS;
      throw err;
    }

    let newBalance;
    let source;

    if (hasTrialSongs) {
      // Use trial song first. Atomic decrement: WHERE guard prevents double-spend
      // if two requests race past the SELECT above (BILL-02).
      source = "trial";
      const trialResult = await query(
        `UPDATE entitlements SET
          trial_songs_remaining = trial_songs_remaining - 1,
          songs_used_total = songs_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND trial_songs_remaining > 0`,
        [userId],
      );
      if ((trialResult.changes ?? trialResult.rowCount ?? 0) === 0) {
        const err = new Error("Insufficient songs remaining");
        err.code = ENTITLEMENT_ERRORS.INSUFFICIENT_SONGS;
        throw err;
      }
      newBalance = current.trial_songs_remaining - 1;
    } else if (hasRegularSongs) {
      // Use regular song. Atomic decrement: WHERE guard prevents double-spend (BILL-02).
      source = "subscription";
      const songResult = await query(
        `UPDATE entitlements SET
          songs_remaining = songs_remaining - 1,
          songs_used_total = songs_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND songs_remaining > 0`,
        [userId],
      );
      if ((songResult.changes ?? songResult.rowCount ?? 0) === 0) {
        const err = new Error("Insufficient songs remaining");
        err.code = ENTITLEMENT_ERRORS.INSUFFICIENT_SONGS;
        throw err;
      }
      newBalance = current.songs_remaining - 1;
    } else {
      // BILL-GIFT: Spend a one-off gift_wallet token (bundle). Only reachable when
      // both trial + subscription are exhausted (the early hasGiftTokens check
      // passed). The atomic
      // UPDATE...WHERE balance > 0 is the SOLE double-spend guard (same as the
      // trial/subscription paths) — a request racing past the SELECT cannot
      // double-spend the last token: it blocks on the row lock, re-reads
      // balance = 0, matches 0 rows, and throws INSUFFICIENT.
      source = "gift_token";
      const giftResult = await query(
        `UPDATE gift_wallet SET
          balance = balance - 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND balance > 0`,
        [userId],
      );
      if ((giftResult.changes ?? giftResult.rowCount ?? 0) === 0) {
        const err = new Error("Insufficient songs remaining");
        err.code = ENTITLEMENT_ERRORS.INSUFFICIENT_SONGS;
        throw err;
      }

      // Re-read the post-decrement balance from WITHIN this tx so the immutable
      // ledger records the TRUE balance, not a stale pre-UPDATE snapshot (the
      // gift_wallet can be concurrently mutated by the gift-send flow).
      const afterRes = await query(
        "SELECT balance FROM gift_wallet WHERE user_id = ?",
        [userId],
      );
      const balanceAfter = Number(afterRes.rows?.[0]?.balance ?? 0);
      const balanceBefore = balanceAfter + 1;
      newBalance = balanceAfter;

      // Keep songs_used_total consistent with the trial/subscription paths so
      // analytics counts gift-funded renders too.
      await query(
        `UPDATE entitlements SET
          songs_used_total = songs_used_total + 1,
          gift_songs_used_total = gift_songs_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [userId],
      );

      // Record the debit in the gift_wallet ledger (same columns as
      // applyGiftWalletTransaction in server.js, which is a closure there and
      // cannot run inside this tx). A deterministic idempotency_key per
      // track_version gives the ledger the same replay-dedup guarantee as
      // gift_reserve/credits (the partial unique index ignores NULL keys).
      const giftTxId = `gwtx_${crypto.randomBytes(12).toString("hex")}`;
      await query(
        `INSERT INTO gift_wallet_transactions (
          id, user_id, type, amount, balance_before, balance_after,
          source, reference_type, reference_id, description, metadata_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          giftTxId,
          userId,
          "song_spend",
          -1,
          balanceBefore,
          balanceAfter,
          "gift_token",
          "track",
          trackId,
          "Song rendered from gift_token",
          null,
          trackVersionId ? `song_spend_${trackVersionId}` : null,
        ],
      );

      // Gift-token spends are tracked in the gift_wallet ledger, not in
      // song_transactions. The combined remaining count is unchanged for the
      // ongoing ledgers (trial + subscription were both 0 here).
      const validTrialRemaining = !trialExpired
        ? current.trial_songs_remaining || 0
        : 0;
      return {
        songsRemaining: (current.songs_remaining || 0) + validTrialRemaining,
        source,
      };
    }

    // Record transaction
    await recordSongTransaction(
      query,
      userId,
      TRANSACTION_TYPES.SPEND,
      -1,
      source === "trial"
        ? current.trial_songs_remaining
        : current.songs_remaining,
      newBalance,
      "track",
      trackId,
      `Song rendered from ${source}`,
    );

    // Only include trial_songs_remaining in the total if the trial is still valid.
    // An expired trial may still have a non-zero DB count until the cleanup job runs.
    const validTrialRemaining = !trialExpired
      ? current.trial_songs_remaining || 0
      : 0;
    return {
      songsRemaining:
        source === "trial"
          ? newBalance + (current.songs_remaining || 0)
          : newBalance + validTrialRemaining,
      source,
    };
  }

  /**
   * Spend a poem (when generating poem content)
   * @param {string} userId - User ID
   * @param {string} poemId - Poem ID for reference
   * @returns {Promise<Object>} Updated balance
   */
  async function spendPoem(userId, poemId) {
    return db.transaction(async (query) =>
      spendPoemInTransaction(query, userId, poemId),
    );
  }

  async function spendPoemInTransaction(query, userId, poemId) {
    const entResult = await query(
      "SELECT poems_remaining, poems_used_total FROM entitlements WHERE user_id = ?",
      [userId],
    );

    if (entResult.rows.length === 0) {
      const err = new Error("No entitlements found for user");
      err.code = ENTITLEMENT_ERRORS.NO_ENTITLEMENTS;
      throw err;
    }

    const current = entResult.rows[0];

    if ((current.poems_remaining || 0) <= 0) {
      const err = new Error("Insufficient poems remaining");
      err.code = ENTITLEMENT_ERRORS.INSUFFICIENT_POEMS;
      throw err;
    }

    // Atomic decrement: WHERE guard prevents double-spend if two requests race
    // past the SELECT above (BILL-03).
    const poemResult = await query(
      `UPDATE entitlements SET
        poems_remaining = poems_remaining - 1,
        poems_used_total = poems_used_total + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND poems_remaining > 0`,
      [userId],
    );
    if ((poemResult.changes ?? poemResult.rowCount ?? 0) === 0) {
      const err = new Error("Insufficient poems remaining");
      err.code = ENTITLEMENT_ERRORS.INSUFFICIENT_POEMS;
      throw err;
    }
    const newBalance = current.poems_remaining - 1;

    await recordSongTransaction(
      query,
      userId,
      TRANSACTION_TYPES.SPEND,
      -1,
      current.poems_remaining,
      newBalance,
      "poem",
      poemId,
      "Poem generated",
    );

    return { poemsRemaining: newBalance };
  }

  /**
   * Grant poems to user (admin function)
   * @param {string} userId - User ID
   * @param {number} amount - Number of poems to grant
   * @param {string} reason - Reason for grant
   */
  async function adminGrantPoems(userId, amount, reason) {
    return db.transaction(async (query) => {
      const entResult = await query(
        "SELECT poems_remaining FROM entitlements WHERE user_id = ?",
        [userId],
      );

      const currentBalance = entResult.rows[0]?.poems_remaining || 0;
      const newBalance = currentBalance + amount;

      await query(
        `INSERT INTO entitlements (user_id, tier, poems_remaining, updated_at)
         VALUES (?, 'free', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           poems_remaining = entitlements.poems_remaining + ?,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, amount, amount],
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
        reason,
      );

      return { poemsGranted: amount, poemsRemaining: newBalance };
    });
  }

  /**
   * Get subscription by original transaction ID
   */
  async function getSubscriptionByOriginalTx(originalTransactionId) {
    const result = await db.query(
      "SELECT * FROM subscriptions WHERE original_transaction_id = ?",
      [originalTransactionId],
    );
    return result.rows[0] || null;
  }

  /**
   * Get user's active subscription
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Active subscription or null
   */
  async function getActiveSubscription(userId) {
    const result = await db
      .prepare(
        `SELECT * FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'grace_period', 'billing_retry')
         AND (
           (expires_at IS NULL OR expires_at > ?)
           OR (grace_period_expires_at IS NOT NULL AND grace_period_expires_at > ?)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      )
      .get(userId, new Date().toISOString(), new Date().toISOString());
    return result || null;
  }

  /**
   * Get user entitlements
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Entitlements or null
   */
  async function getEntitlements(userId) {
    const ent = await db
      .prepare("SELECT * FROM entitlements WHERE user_id = ?")
      .get(userId);

    if (!ent) {
      return null;
    }

    const toSafeInt = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : fallback;
    };

    const baseSongsRemaining = toSafeInt(ent.songs_remaining);
    // H1: Zero out trial songs if trial has expired
    const trialExpired =
      ent.trial_expires_at && new Date(ent.trial_expires_at) < new Date();
    const trialSongsRemaining = trialExpired
      ? 0
      : toSafeInt(ent.trial_songs_remaining);

    // H2 + H3: Resolve effective tier (subscription + admin upgrade overlay)
    const effectiveTier = await resolveEffectiveTier(ent);

    // BILL-GIFT: Expose the one-off gift_wallet balance (bundles) alongside the
    // ongoing ledgers. This is reported separately and does NOT alter the
    // existing songsRemaining (base + trial) value.
    const walletRow = await db
      .prepare("SELECT balance FROM gift_wallet WHERE user_id = ?")
      .get(userId);
    const giftWalletBalance = toSafeInt(walletRow?.balance);

    return {
      userId: ent.user_id,
      tier: effectiveTier,
      baseSongsRemaining,
      songsRemaining: baseSongsRemaining + trialSongsRemaining,
      giftWalletBalance,
      songsAllowance: toSafeInt(ent.songs_allowance),
      songsUsedTotal: toSafeInt(ent.songs_used_total),
      giftSongsUsedTotal: toSafeInt(ent.gift_songs_used_total),
      poemsRemaining: toSafeInt(ent.poems_remaining),
      poemsAllowance: toSafeInt(ent.poems_allowance),
      poemsUsedTotal: toSafeInt(ent.poems_used_total),
      trialSongsRemaining,
      trialExpiresAt: ent.trial_expires_at
        ? new Date(ent.trial_expires_at)
        : null,
      previewCountToday: toSafeInt(ent.preview_count_today),
      planId: ent.plan_id || null,
      billingPeriod: ent.billing_period || null,
      subscriptionStartsAt: ent.subscription_starts_at
        ? new Date(ent.subscription_starts_at)
        : null,
      subscriptionRenewsAt: ent.subscription_renews_at
        ? new Date(ent.subscription_renews_at)
        : null,
      adminUpgradeTier: ent.admin_upgrade_tier || null,
      adminUpgradeExpiresAt: ent.admin_upgrade_expires_at
        ? new Date(ent.admin_upgrade_expires_at)
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
        [userId],
      );

      const currentBalance = entResult.rows[0]?.songs_remaining || 0;
      const newBalance = currentBalance + amount;

      await query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at)
         VALUES (?, 'free', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           songs_remaining = entitlements.songs_remaining + ?,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, amount, amount],
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
        reason,
      );

      return { songsGranted: amount, songsRemaining: newBalance };
    });
  }

  /**
   * Admin complimentary upgrade — grant time-limited tier override
   * @param {string} userId - User ID
   * @param {string} tier - Target tier ('plus' or 'pro')
   * @param {number} durationDays - Duration in days (1-365)
   * @param {string} reason - Audit reason
   * @param {string} [adminId] - Admin who performed the action
   */
  async function adminComplimentaryUpgrade(
    userId,
    tier,
    durationDays,
    reason,
    adminId,
  ) {
    if (!["plus", "pro"].includes(tier)) {
      throw new Error("Tier must be 'plus' or 'pro'");
    }

    const plan = await planConfigService.getPlanByTier(tier);
    if (!plan) {
      throw new Error(`No plan found for tier '${tier}'`);
    }

    const expiresAt = new Date(
      Date.now() + durationDays * 86400000,
    ).toISOString();
    const songsToGrant = plan.songs_per_month || 0;
    const poemsToGrant = plan.poems_per_month || 0;

    return db.transaction(async (query) => {
      await acquireUserLock(query, userId);

      const entResult = await query(
        "SELECT songs_remaining, poems_remaining FROM entitlements WHERE user_id = ?",
        [userId],
      );
      const current = entResult.rows[0];
      if (!current) {
        throw new Error("User has no entitlements row");
      }

      const songsBefore = current.songs_remaining || 0;
      const songsAfter = songsBefore + songsToGrant;

      await query(
        `UPDATE entitlements SET
          admin_upgrade_tier = ?,
          admin_upgrade_expires_at = ?,
          songs_remaining = songs_remaining + ?,
          songs_allowance = ?,
          poems_remaining = poems_remaining + ?,
          poems_allowance = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [
          tier,
          expiresAt,
          songsToGrant,
          songsToGrant,
          poemsToGrant,
          poemsToGrant,
          userId,
        ],
      );

      if (songsToGrant > 0) {
        await recordSongTransaction(
          query,
          userId,
          TRANSACTION_TYPES.ADMIN_UPGRADE,
          songsToGrant,
          songsBefore,
          songsAfter,
          "admin",
          null,
          `Complimentary ${tier} upgrade (${durationDays}d): ${reason}`,
        );
      }

      if (writeAuditLog) {
        await writeAuditLog({
          userId,
          action: "admin_complimentary_upgrade",
          resourceType: "entitlements",
          metadata: {
            tier,
            durationDays,
            reason,
            adminId: adminId || null,
            songsGranted: songsToGrant,
            poemsGranted: poemsToGrant,
            expiresAt,
          },
        });
      }

      return {
        success: true,
        tier,
        songsGranted: songsToGrant,
        poemsGranted: poemsToGrant,
        expiresAt,
      };
    });
  }

  /**
   * Revoke admin complimentary upgrade (songs remain — permanent grant)
   * @param {string} userId - User ID
   * @param {string} reason - Audit reason
   * @param {string} [adminId] - Admin who performed the action
   */
  async function revokeComplimentaryUpgrade(userId, reason, adminId) {
    return db.transaction(async (query) => {
      await acquireUserLock(query, userId);

      await query(
        `UPDATE entitlements SET
          admin_upgrade_tier = NULL,
          admin_upgrade_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [userId],
      );

      if (writeAuditLog) {
        await writeAuditLog({
          userId,
          action: "admin_revoke_upgrade",
          resourceType: "entitlements",
          metadata: { reason, adminId: adminId || null },
        });
      }

      return { success: true };
    });
  }

  /**
   * Record a song transaction for audit trail
   */
  async function recordSongTransaction(
    query,
    userId,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    source,
    referenceId,
    description,
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
      ],
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
    // Get plan info from product ID (safe to read outside transaction — immutable config)
    const planInfo = await planConfigService.getPlanByProductId(
      subscriptionId,
      "google",
    );

    // Map Google status to internal status
    const internalStatus = mapGoogleStatus(status);

    // All mutable state reads (subscription lookup, ownership check) happen INSIDE the
    // transaction to prevent TOCTOU races (BILL-09). The FOR UPDATE lock serializes
    // concurrent syncs for the same purchaseToken.
    return db.transaction(async (query) => {
      const lockSuffix = await acquireUserLock(query, userId);
      const existingResult = await query(
        `SELECT * FROM subscriptions WHERE original_transaction_id = ? AND platform = 'google'${lockSuffix}`,
        [purchaseToken],
      );
      const existingSubscription = existingResult.rows[0];
      const isNewSubscription = !existingSubscription;

      // Security check: Verify subscription ownership before allowing updates (BILL-09)
      if (existingSubscription && existingSubscription.user_id !== userId) {
        throw new Error("SUBSCRIPTION_BELONGS_TO_ANOTHER_USER");
      }

      const resolvedTier = planInfo?.tier || tier || "premium";
      const subscriptionDbId =
        existingSubscription?.id ||
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
          ],
        );

        // Grant songs for new subscription
        let entitlementResult = null;
        if (
          planInfo &&
          (internalStatus === STATUS.ACTIVE ||
            internalStatus === STATUS.GRACE_PERIOD)
        ) {
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
              [userId, resolvedTier, songsToGrant, songsToGrant, songsToGrant],
            );
            entitlementResult = {
              songsGranted: songsToGrant,
              songsRemaining: songsToGrant,
              isRenewal: false,
            };
          }
        }
        if (!entitlementResult) {
          entitlementResult = {
            songsGranted: 0,
            songsRemaining: 0,
            isRenewal: false,
          };
        }
        return {
          id: subscriptionDbId,
          tier: resolvedTier,
          status: internalStatus,
          expires_at: expiresAt,
          auto_renewing: autoRenewing,
          is_new: isNewSubscription,
          songsGranted: entitlementResult.songsGranted,
          songsRemaining: entitlementResult.songsRemaining,
          isRenewal: entitlementResult.isRenewal,
        };
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
          ],
        );

        // BILL-01: Update entitlements on renewal/plan change (mirrors Apple sync path)
        let entitlementResult = null;
        if (
          planInfo &&
          (internalStatus === STATUS.ACTIVE ||
            internalStatus === STATUS.GRACE_PERIOD)
        ) {
          const isRenewal =
            existingSubscription.status === "expired" ||
            existingSubscription.status === "grace_period" ||
            (existingSubscription.expires_at &&
              new Date(existingSubscription.expires_at) < new Date());
          const validation = {
            isActive: true,
            isExpired: false,
            isTrialPeriod: false,
            productId: subscriptionId,
            originalPurchaseDate: existingSubscription.original_purchase_date
              ? new Date(existingSubscription.original_purchase_date)
              : new Date(),
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          };
          entitlementResult = await updateEntitlements(
            query,
            userId,
            planInfo,
            validation,
            false,
            isRenewal,
            subscriptionDbId,
          );
          return {
            id: subscriptionDbId,
            tier: resolvedTier,
            status: internalStatus,
            expires_at: expiresAt,
            auto_renewing: autoRenewing,
            is_new: isNewSubscription,
            songsGranted: entitlementResult?.songsGranted || 0,
            songsRemaining: entitlementResult?.songsRemaining || 0,
            isRenewal,
          };
        }
        return {
          id: subscriptionDbId,
          tier: resolvedTier,
          status: internalStatus,
          expires_at: expiresAt,
          auto_renewing: autoRenewing,
          is_new: isNewSubscription,
          songsGranted: entitlementResult?.songsGranted || 0,
          songsRemaining: entitlementResult?.songsRemaining || 0,
          isRenewal: false,
        };
      }
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
      validation?.isInBillingRetry,
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

  /**
   * Create default free-tier entitlements for a new user.
   * Reads the one-time signup grant from admin-managed feature flags.
   * @param {string} userId
   * @param {Object} [opts]
   * @param {string} [opts.now] - ISO timestamp (defaults to current time)
   * @param {number} [opts.previewCountToday] - Initial preview count (default 0)
   * @param {string} [opts.previewCountResetAt] - Reset timestamp
   */
  /**
   * Decide whether a FREE grant of `kind` should be suppressed for this request.
   * Suppressed (0-song) when:
   *   - the identity hash has already received a grant of this kind (Sybil tombstone), OR
   *   - the user's risk_level is high/blocked.
   * Returns { suppressed, hash }. `hash` is null when no identity was supplied
   * (legacy callers) — in that case only risk_level can suppress.
   */
  async function evaluateFreeGrantGate(query, userId, kind, identity) {
    const userRow = (
      await query("SELECT risk_level FROM users WHERE id = ?", [userId])
    ).rows[0];
    const riskBlocked =
      userRow?.risk_level === "high" || userRow?.risk_level === "blocked";

    let hash = null;
    let tombstoned = false;
    if (identity?.provider && identity?.subject) {
      hash = identityHash(identity.provider, identity.subject);
      const existing = await query(
        "SELECT 1 FROM granted_identities WHERE identity_hash = ? AND grant_kind = ?",
        [hash, kind],
      );
      tombstoned = existing.rows.length > 0;
    }

    return { suppressed: riskBlocked || tombstoned, hash };
  }

  async function createFreeEntitlements(userId, opts = {}) {
    const configuredSongsGrant = await getFeatureFlag(
      db,
      "free_tier_songs_grant",
    );
    const poemsGrant = await getFeatureFlag(db, "free_tier_poems_grant");
    const now = opts.now || new Date().toISOString();
    const previewCountToday = opts.previewCountToday ?? 0;
    const previewCountResetAt =
      opts.previewCountResetAt || new Date(Date.now() + 86400000).toISOString();

    await db.transaction(async (query) => {
      const { suppressed, hash } = await evaluateFreeGrantGate(
        query,
        userId,
        "signup",
        opts.identity,
      );
      const songsGrant = suppressed ? 0 : configuredSongsGrant;

      const result = await query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, poems_remaining,
          preview_count_today, preview_count_reset_at, updated_at)
         VALUES (?, 'free', ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          userId,
          songsGrant,
          poemsGrant,
          previewCountToday,
          previewCountResetAt,
          now,
        ],
      );

      const inserted = (result.changes ?? result.rowCount ?? 0) > 0;

      if (inserted && songsGrant > 0) {
        await recordSongTransaction(
          query,
          userId,
          TRANSACTION_TYPES.FREE_SIGNUP_GRANT,
          songsGrant,
          0,
          songsGrant,
          "free_signup",
          userId,
          "Free signup song grant",
        );
        // Record the tombstone so this identity cannot re-farm the free grant.
        if (hash) {
          await query(
            `INSERT INTO granted_identities (identity_hash, grant_kind)
             VALUES (?, 'signup')
             ON CONFLICT (identity_hash) DO NOTHING`,
            [hash],
          );
        }
      }
    });
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

    // Admin upgrades
    adminComplimentaryUpgrade,
    revokeComplimentaryUpgrade,

    // Poem management
    spendPoem,
    spendPoemInTransaction,
    adminGrantPoems,

    // User provisioning
    createFreeEntitlements,

    // Queries
    getActiveSubscription,
    getSubscriptionByOriginalTx,
    getEntitlements,
    getEffectiveTier,

    // Constants
    TRANSACTION_TYPES,
    STATUS,
  };
}

module.exports = {
  createSubscriptionManager,
  TRANSACTION_TYPES,
  STATUS,
  ENTITLEMENT_ERRORS,
};
