"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function affectedRows(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function createSubscriptionEntitlementsRepository(db) {
  function runner(query = null) {
    return query ? createPreparedDbFromQuery(query, db) : db;
  }

  async function acquireUserLock(query, userId) {
    if (db.isPostgres) {
      await query("SELECT pg_advisory_xact_lock(hashtext(?))", [userId]);
    }
    return db.isPostgres ? " FOR UPDATE" : "";
  }

  async function findActiveSubscriptionIdForTier({ userId, now }) {
    return db
      .prepare(
        `SELECT id FROM subscriptions
         WHERE user_id = ? AND status IN ('active', 'grace_period', 'billing_retry')
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
      )
      .get(userId, now);
  }

  async function findEntitlementTierFields(userId) {
    return db
      .prepare(
        "SELECT user_id, tier, admin_upgrade_tier, admin_upgrade_expires_at FROM entitlements WHERE user_id = ?",
      )
      .get(userId);
  }

  async function findSubscriptionByOriginalTransactionId(
    originalTransactionId,
    { query = null, lockSuffix = "" } = {},
  ) {
    return runner(query)
      .prepare(
        `SELECT * FROM subscriptions
         WHERE original_transaction_id = ?${lockSuffix}`,
      )
      .get(originalTransactionId);
  }

  async function findLatestSubscriptionByUserAndProduct({
    userId,
    productId,
    query = null,
    lockSuffix = "",
  }) {
    return runner(query)
      .prepare(
        `SELECT * FROM subscriptions
         WHERE user_id = ? AND product_id = ?
         ORDER BY
           CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC,
           expires_at DESC,
           created_at DESC
         LIMIT 1${lockSuffix}`,
      )
      .get(userId, productId);
  }

  async function insertAppleSubscription({
    subscriptionId,
    userId,
    validation,
    tier,
    status,
    query,
  }) {
    return runner(query)
      .prepare(
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
      )
      .run(
        subscriptionId,
        userId,
        validation.productId,
        tier,
        status,
        validation.platform,
        validation.originalTransactionId,
        validation.transactionId,
        validation.originalPurchaseDate.toISOString(),
        validation.expiresAt?.toISOString() || null,
        validation.autoRenewEnabled ? 1 : 0,
        validation.gracePeriodExpiresAt?.toISOString() || null,
        validation.environment,
        0,
      );
  }

  async function updateAppleSubscription({
    subscriptionId,
    validation,
    tier,
    status,
    renewalIncrement,
    query,
  }) {
    return runner(query)
      .prepare(
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
      )
      .run(
        validation.productId,
        tier,
        status,
        validation.originalTransactionId,
        validation.transactionId,
        validation.originalPurchaseDate.toISOString(),
        validation.expiresAt?.toISOString() || null,
        validation.autoRenewEnabled ? 1 : 0,
        validation.gracePeriodExpiresAt?.toISOString() || null,
        renewalIncrement,
        validation.environment,
        subscriptionId,
      );
  }

  async function recordPurchaseReceipt({
    receiptId,
    userId,
    subscriptionId,
    validation,
    verificationResponse,
    query,
  }) {
    return runner(query)
      .prepare(
        `INSERT INTO purchase_receipts (
          id, user_id, subscription_id, transaction_id, original_transaction_id,
          product_id, platform, verification_status, verification_response,
          purchase_date, expires_date, is_trial, is_upgrade, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(transaction_id) DO UPDATE SET
          verification_status = excluded.verification_status,
          verification_response = excluded.verification_response,
          expires_date = excluded.expires_date`,
      )
      .run(
        receiptId,
        userId,
        subscriptionId,
        validation.transactionId,
        validation.originalTransactionId,
        validation.productId,
        validation.platform,
        "verified",
        verificationResponse,
        validation.purchaseDate.toISOString(),
        validation.expiresAt?.toISOString() || null,
        validation.isTrialPeriod ? 1 : 0,
        0,
      );
  }

  async function findEntitlementsByUserId(userId, { query = null } = {}) {
    return runner(query)
      .prepare("SELECT * FROM entitlements WHERE user_id = ?")
      .get(userId);
  }

  async function findTrialActivationEntitlements({
    userId,
    query,
    lockSuffix = "",
  }) {
    return runner(query)
      .prepare(
        `SELECT songs_remaining, trial_songs_remaining, trial_started_at, tier
         FROM entitlements WHERE user_id = ?${lockSuffix}`,
      )
      .get(userId);
  }

  async function upsertSubscriptionEntitlements({
    userId,
    tier,
    songsRemaining,
    songsAllowance,
    songsUsedTotal,
    poemsRemaining,
    poemsAllowance,
    previewCountToday,
    planId,
    billingPeriod,
    subscriptionStartsAt,
    subscriptionRenewsAt,
    query,
  }) {
    return runner(query)
      .prepare(
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
      )
      .run(
        userId,
        tier,
        songsRemaining,
        songsAllowance,
        songsUsedTotal,
        poemsRemaining,
        poemsAllowance,
        previewCountToday,
        planId,
        billingPeriod,
        subscriptionStartsAt,
        subscriptionRenewsAt,
      );
  }

  async function activateTrialEntitlements({
    userId,
    songsGranted,
    trialExpiresAt,
    query,
  }) {
    return runner(query)
      .prepare(
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
      )
      .run(
        userId,
        songsGranted,
        trialExpiresAt,
        songsGranted,
        trialExpiresAt,
      );
  }

  async function insertGrantedIdentityTombstone({ hash, kind, query }) {
    return runner(query)
      .prepare(
        `INSERT INTO granted_identities (identity_hash, grant_kind)
         VALUES (?, ?)
         ON CONFLICT (identity_hash, grant_kind) DO NOTHING`,
      )
      .run(hash, kind);
  }

  async function findSubscriptionById(subscriptionId, { query = null } = {}) {
    return runner(query)
      .prepare("SELECT * FROM subscriptions WHERE id = ?")
      .get(subscriptionId);
  }

  async function markSubscriptionExpired({ subscriptionId, query }) {
    return runner(query)
      .prepare(
        `UPDATE subscriptions SET
          status = 'expired',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(subscriptionId);
  }

  async function clearExpiredSubscriptionFieldsForAdminUpgrade({
    userId,
    query,
  }) {
    return runner(query)
      .prepare(
        `UPDATE entitlements SET
          tier = 'free',
          plan_id = NULL,
          billing_period = NULL,
          subscription_renews_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      )
      .run(userId);
  }

  async function resetEntitlementsForExpiredSubscription({ userId, query }) {
    return runner(query)
      .prepare(
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
      )
      .run(userId);
  }

  async function markSubscriptionGracePeriod({
    subscriptionId,
    gracePeriodExpiresAt,
  }) {
    return db
      .prepare(
        `UPDATE subscriptions SET
          status = 'grace_period',
          grace_period_expires_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(gracePeriodExpiresAt, subscriptionId);
  }

  async function markSubscriptionRevoked({ subscriptionId, query }) {
    return runner(query)
      .prepare(
        `UPDATE subscriptions SET
          status = 'revoked',
          cancelled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(subscriptionId);
  }

  async function sumGrantedSongsForSubscription({
    userId,
    subscriptionId,
    grantType,
    renewalType,
    query,
  }) {
    const row = await runner(query)
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total_granted
         FROM song_transactions
         WHERE user_id = ? AND reference_id = ?
           AND type IN (?, ?)`,
      )
      .get(userId, subscriptionId, grantType, renewalType);
    return Number(row?.total_granted || 0);
  }

  async function updateRevokedEntitlementsWithAdminUpgrade({
    userId,
    songsRemaining,
    query,
  }) {
    return runner(query)
      .prepare(
        `UPDATE entitlements SET
          tier = 'free',
          songs_remaining = ?,
          plan_id = NULL,
          billing_period = NULL,
          subscription_renews_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      )
      .run(songsRemaining, userId);
  }

  async function updateRevokedEntitlements({
    userId,
    songsRemaining,
    poemsRemaining,
    query,
  }) {
    return runner(query)
      .prepare(
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
      )
      .run(songsRemaining, poemsRemaining, userId);
  }

  async function decrementTrialSong({ userId, query }) {
    const result = await runner(query)
      .prepare(
        `UPDATE entitlements SET
          trial_songs_remaining = trial_songs_remaining - 1,
          songs_used_total = songs_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND trial_songs_remaining > 0`,
      )
      .run(userId);
    return affectedRows(result);
  }

  async function decrementSubscriptionSong({ userId, query }) {
    const result = await runner(query)
      .prepare(
        `UPDATE entitlements SET
          songs_remaining = songs_remaining - 1,
          songs_used_total = songs_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND songs_remaining > 0`,
      )
      .run(userId);
    return affectedRows(result);
  }

  async function incrementGiftSongUsage({ userId, query }) {
    return runner(query)
      .prepare(
        `UPDATE entitlements SET
          songs_used_total = songs_used_total + 1,
          gift_songs_used_total = gift_songs_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      )
      .run(userId);
  }

  async function findPoemSpendEntitlements(userId, { query }) {
    return runner(query)
      .prepare(
        "SELECT poems_remaining, poems_used_total FROM entitlements WHERE user_id = ?",
      )
      .get(userId);
  }

  async function decrementPoem({ userId, query }) {
    const result = await runner(query)
      .prepare(
        `UPDATE entitlements SET
          poems_remaining = poems_remaining - 1,
          poems_used_total = poems_used_total + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND poems_remaining > 0`,
      )
      .run(userId);
    return affectedRows(result);
  }

  async function findPoemsBalance(userId, { query }) {
    return runner(query)
      .prepare("SELECT poems_remaining FROM entitlements WHERE user_id = ?")
      .get(userId);
  }

  async function grantPoems({ userId, amount, query }) {
    return runner(query)
      .prepare(
        `INSERT INTO entitlements (user_id, tier, poems_remaining, updated_at)
         VALUES (?, 'free', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           poems_remaining = entitlements.poems_remaining + ?,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, amount, amount);
  }

  async function getSubscriptionByOriginalTx(originalTransactionId) {
    return db
      .prepare("SELECT * FROM subscriptions WHERE original_transaction_id = ?")
      .get(originalTransactionId);
  }

  async function getActiveSubscription(userId, { now }) {
    return db
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
      .get(userId, now, now);
  }

  async function findSongsBalance(userId, { query }) {
    return runner(query)
      .prepare("SELECT songs_remaining FROM entitlements WHERE user_id = ?")
      .get(userId);
  }

  async function grantSongs({ userId, amount, query }) {
    return runner(query)
      .prepare(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at)
         VALUES (?, 'free', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           songs_remaining = entitlements.songs_remaining + ?,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, amount, amount);
  }

  async function findUpgradeBalances(userId, { query }) {
    return runner(query)
      .prepare(
        "SELECT songs_remaining, poems_remaining FROM entitlements WHERE user_id = ?",
      )
      .get(userId);
  }

  async function applyComplimentaryUpgrade({
    userId,
    tier,
    expiresAt,
    songsToGrant,
    poemsToGrant,
    query,
  }) {
    return runner(query)
      .prepare(
        `UPDATE entitlements SET
          admin_upgrade_tier = ?,
          admin_upgrade_expires_at = ?,
          songs_remaining = songs_remaining + ?,
          songs_allowance = ?,
          poems_remaining = poems_remaining + ?,
          poems_allowance = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      )
      .run(
        tier,
        expiresAt,
        songsToGrant,
        songsToGrant,
        poemsToGrant,
        poemsToGrant,
        userId,
      );
  }

  async function clearComplimentaryUpgrade({ userId, query }) {
    return runner(query)
      .prepare(
        `UPDATE entitlements SET
          admin_upgrade_tier = NULL,
          admin_upgrade_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      )
      .run(userId);
  }

  async function insertSongTransaction({
    txId,
    userId,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    source,
    referenceId,
    description,
    query,
  }) {
    return runner(query)
      .prepare(
        `INSERT INTO song_transactions (
          id, user_id, type, amount, balance_before, balance_after,
          source, reference_type, reference_id, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        txId,
        userId,
        type,
        amount,
        balanceBefore,
        balanceAfter,
        source,
        source,
        referenceId,
        description,
      );
  }

  async function findGoogleSubscriptionByPurchaseToken({
    purchaseToken,
    query = null,
    lockSuffix = "",
  }) {
    return runner(query)
      .prepare(
        `SELECT * FROM subscriptions WHERE original_transaction_id = ? AND platform = 'google'${lockSuffix}`,
      )
      .get(purchaseToken);
  }

  async function insertGoogleSubscription({
    subscriptionDbId,
    userId,
    subscriptionId,
    tier,
    status,
    purchaseToken,
    orderId,
    expiresAt,
    autoRenewing,
    query,
  }) {
    return runner(query)
      .prepare(
        `INSERT INTO subscriptions (
          id, user_id, product_id, tier, status, platform,
          original_transaction_id, latest_transaction_id,
          original_purchase_date, expires_at, auto_renew_enabled,
          environment, renewal_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'google', ?, ?, CURRENT_TIMESTAMP, ?, ?, 'production', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        subscriptionDbId,
        userId,
        subscriptionId,
        tier,
        status,
        purchaseToken,
        orderId,
        expiresAt || null,
        autoRenewing ? 1 : 0,
      );
  }

  async function grantGoogleNewSubscriptionSongs({
    userId,
    tier,
    songsToGrant,
    query,
  }) {
    return runner(query)
      .prepare(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, songs_allowance, songs_used_total, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           tier = excluded.tier,
           songs_remaining = songs_remaining + ?,
           songs_allowance = excluded.songs_allowance,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, tier, songsToGrant, songsToGrant, songsToGrant);
  }

  async function updateGoogleSubscription({
    subscriptionDbId,
    subscriptionId,
    tier,
    status,
    orderId,
    expiresAt,
    autoRenewing,
    query,
  }) {
    return runner(query)
      .prepare(
        `UPDATE subscriptions SET
          product_id = ?,
          tier = ?,
          status = ?,
          latest_transaction_id = ?,
          expires_at = ?,
          auto_renew_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(
        subscriptionId,
        tier,
        status,
        orderId,
        expiresAt || null,
        autoRenewing ? 1 : 0,
        subscriptionDbId,
      );
  }

  async function findUserRiskLevel(userId, { query }) {
    return runner(query)
      .prepare("SELECT risk_level FROM users WHERE id = ?")
      .get(userId);
  }

  async function hasGrantedIdentity({ hash, kind, query }) {
    const existing = await runner(query)
      .prepare(
        "SELECT 1 FROM granted_identities WHERE identity_hash = ? AND grant_kind = ?",
      )
      .get(hash, kind);
    return Boolean(existing);
  }

  async function createFreeEntitlements({
    userId,
    songsGrant,
    poemsGrant,
    previewCountToday,
    previewCountResetAt,
    now,
    query,
  }) {
    const result = await runner(query)
      .prepare(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, poems_remaining,
          preview_count_today, preview_count_reset_at, updated_at)
         VALUES (?, 'free', ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO NOTHING`,
      )
      .run(userId, songsGrant, poemsGrant, previewCountToday, previewCountResetAt, now);
    return affectedRows(result) > 0;
  }

  async function findGiftBundleByProductId(productId) {
    return db
      .prepare("SELECT token_count, display_name FROM gift_bundles WHERE product_id = ?")
      .get(productId);
  }

  async function findPurchaseReceiptByTransactionId(transactionId, {
    query = null,
  } = {}) {
    return runner(query)
      .prepare(
        "SELECT id, user_id, product_id FROM purchase_receipts WHERE transaction_id = ?",
      )
      .get(transactionId);
  }

  async function findLinkedGoogleSubscriptionByPurchaseToken(purchaseToken) {
    return db
      .prepare(
        "SELECT id, user_id FROM subscriptions WHERE platform = 'google' AND original_transaction_id = ? LIMIT 1",
      )
      .get(purchaseToken);
  }

  return {
    acquireUserLock,
    findActiveSubscriptionIdForTier,
    findEntitlementTierFields,
    findSubscriptionByOriginalTransactionId,
    findLatestSubscriptionByUserAndProduct,
    insertAppleSubscription,
    updateAppleSubscription,
    recordPurchaseReceipt,
    findEntitlementsByUserId,
    findTrialActivationEntitlements,
    upsertSubscriptionEntitlements,
    activateTrialEntitlements,
    insertGrantedIdentityTombstone,
    findSubscriptionById,
    markSubscriptionExpired,
    clearExpiredSubscriptionFieldsForAdminUpgrade,
    resetEntitlementsForExpiredSubscription,
    markSubscriptionGracePeriod,
    markSubscriptionRevoked,
    sumGrantedSongsForSubscription,
    updateRevokedEntitlementsWithAdminUpgrade,
    updateRevokedEntitlements,
    decrementTrialSong,
    decrementSubscriptionSong,
    incrementGiftSongUsage,
    findPoemSpendEntitlements,
    decrementPoem,
    findPoemsBalance,
    grantPoems,
    getSubscriptionByOriginalTx,
    getActiveSubscription,
    findSongsBalance,
    grantSongs,
    findUpgradeBalances,
    applyComplimentaryUpgrade,
    clearComplimentaryUpgrade,
    insertSongTransaction,
    findGoogleSubscriptionByPurchaseToken,
    insertGoogleSubscription,
    grantGoogleNewSubscriptionSongs,
    updateGoogleSubscription,
    findUserRiskLevel,
    hasGrantedIdentity,
    createFreeEntitlements,
    findGiftBundleByProductId,
    findPurchaseReceiptByTransactionId,
    findLinkedGoogleSubscriptionByPurchaseToken,
  };
}

module.exports = { createSubscriptionEntitlementsRepository };
