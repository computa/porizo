"use strict";

function countFrom(row) {
  return Number(row?.count || 0);
}

function createAdminBillingRepository(db) {
  async function listGiftBundlesForAdmin() {
    return db.prepare("SELECT * FROM gift_bundles ORDER BY sort_order ASC").all();
  }

  async function listGiftBundleProducts() {
    return db
      .prepare(
        `
        SELECT product_id, display_name, price_cents
        FROM gift_bundles
      `,
      )
      .all();
  }

  async function resetPreviewCount({ userId, updatedAt }) {
    return db
      .prepare(
        "UPDATE entitlements SET preview_count_today = 0, updated_at = ? WHERE user_id = ?",
      )
      .run(updatedAt, userId);
  }

  async function getGiftBundleById(id) {
    return db.prepare("SELECT * FROM gift_bundles WHERE id = ?").get(id);
  }

  async function updateGiftBundleFields({ id, updates, updatedAt, updatedBy }) {
    const allowedColumns = new Set([
      "token_count",
      "display_name",
      "description",
      "is_active",
      "sort_order",
    ]);
    const entries = Object.entries(updates || {});
    if (entries.length === 0) {
      throw new Error("No gift bundle updates provided");
    }

    const setClauses = [];
    const params = [];
    for (const [key, value] of entries) {
      if (!allowedColumns.has(key)) {
        throw new Error(`Unsafe gift bundle column: ${key}`);
      }
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
    setClauses.push("updated_at = ?");
    params.push(updatedAt);
    setClauses.push("updated_by = ?");
    params.push(updatedBy);
    params.push(id);

    return db
      .prepare(`UPDATE gift_bundles SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  async function listPlanProducts() {
    return db
      .prepare(
        `
        SELECT
          pp.product_id,
          pp.billing_period,
          sp.name,
          sp.tier,
          sp.price_monthly_cents,
          sp.price_annual_cents
        FROM plan_products pp
        LEFT JOIN subscription_plans sp ON sp.id = pp.plan_id
      `,
      )
      .all();
  }

  async function listReceiptSaleRows({ since = null, limit = 50, offset = 0 } = {}) {
    const where = ["pr.verification_status = 'verified'"];
    const params = [];
    if (since) {
      where.push("pr.purchase_date > ?");
      params.push(since);
    }

    return db
      .prepare(
        `
        SELECT
          pr.id,
          pr.user_id,
          pr.subscription_id,
          pr.transaction_id,
          pr.original_transaction_id,
          pr.product_id,
          pr.platform,
          pr.verification_status,
          pr.verification_response,
          pr.purchase_date,
          pr.expires_date,
          pr.is_trial,
          pr.created_at,
          u.email AS user_email,
          u.display_name AS user_display_name,
          uc.value_display AS primary_email,
          s.status AS subscription_status,
          s.tier AS subscription_tier,
          s.expires_at AS subscription_expires_at,
          s.grace_period_expires_at AS subscription_grace_period_expires_at,
          s.auto_renew_enabled AS auto_renew_enabled,
          s.cancelled_at AS subscription_cancelled_at,
          s.latest_transaction_id AS latest_transaction_id,
          gwt.id AS gift_wallet_transaction_id,
          gwt.amount AS gift_tokens_granted
        FROM purchase_receipts pr
        LEFT JOIN users u ON u.id = pr.user_id
        LEFT JOIN user_contacts uc
          ON uc.user_id = pr.user_id
         AND uc.type = 'email'
         AND uc.is_primary = true
        LEFT JOIN subscriptions s ON s.id = pr.subscription_id
        LEFT JOIN gift_wallet_transactions gwt
          ON gwt.reference_type = 'receipt'
         AND gwt.reference_id = pr.id
         AND gwt.type = 'gift_purchase'
        WHERE ${where.join(" AND ")}
        ORDER BY pr.purchase_date DESC, pr.created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, limit, offset);
  }

  async function countCurrentSubscribers({ now }) {
    const row = await db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM subscriptions s
        WHERE s.status IN ('active', 'grace_period', 'billing_retry')
          AND (
            s.expires_at IS NULL
            OR s.expires_at > ?
            OR s.grace_period_expires_at > ?
          )
      `,
      )
      .get(now, now);
    return countFrom(row);
  }

  async function listCurrentSubscribers({ now, limit = 50 } = {}) {
    return db
      .prepare(
        `
        SELECT
          s.id,
          s.user_id,
          s.product_id,
          s.tier,
          s.status,
          s.platform,
          s.original_transaction_id,
          s.latest_transaction_id,
          s.original_purchase_date,
          s.expires_at,
          s.auto_renew_enabled,
          s.grace_period_expires_at,
          s.cancelled_at,
          s.updated_at,
          u.email AS user_email,
          u.display_name AS user_display_name,
          uc.value_display AS primary_email
        FROM subscriptions s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN user_contacts uc
          ON uc.user_id = s.user_id
         AND uc.type = 'email'
         AND uc.is_primary = true
        WHERE s.status IN ('active', 'grace_period', 'billing_retry')
          AND (
            s.expires_at IS NULL
            OR s.expires_at > ?
            OR s.grace_period_expires_at > ?
          )
        ORDER BY
          CASE s.status
            WHEN 'active' THEN 0
            WHEN 'grace_period' THEN 1
            WHEN 'billing_retry' THEN 2
            ELSE 3
          END,
          s.expires_at ASC,
          s.updated_at DESC
        LIMIT ?
      `,
      )
      .all(now, now, limit);
  }

  async function listSubscriptionsByTierSince({ since = null } = {}) {
    return db
      .prepare(
        `
        SELECT
          tier,
          COUNT(*) as count,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
        FROM subscriptions
        WHERE (? IS NULL OR created_at > ?)
        GROUP BY tier
      `,
      )
      .all(since, since);
  }

  async function getTrialConversionStatsSince({ since = null } = {}) {
    return db
      .prepare(
        `
        SELECT
          COUNT(CASE WHEN status = 'trial' THEN 1 END) as current_trials,
          COUNT(CASE WHEN status = 'active' AND original_purchase_date IS NOT NULL THEN 1 END) as converted_trials
        FROM subscriptions
        WHERE (? IS NULL OR created_at > ?)
      `,
      )
      .get(since, since);
  }

  async function countCancelledSubscriptionsSince({ since = null } = {}) {
    const row = await db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM subscriptions
        WHERE cancelled_at IS NOT NULL AND (? IS NULL OR cancelled_at > ?)
      `,
      )
      .get(since, since);
    return countFrom(row);
  }

  async function countActiveSubscriptions() {
    const row = await db
      .prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'")
      .get();
    return countFrom(row);
  }

  async function getSubscriptionHealthCounts({ now, weekFromNow, weekAgo }) {
    const byTier = await db
      .prepare(
        `
        SELECT tier, COUNT(*) as count
        FROM subscriptions
        WHERE status = 'active'
        GROUP BY tier
      `,
      )
      .all();

    const trialCount = countFrom(
      await db
        .prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'trial'")
        .get(),
    );

    const expiringThisWeek = countFrom(
      await db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM subscriptions
          WHERE status = 'active' AND expires_at <= ? AND expires_at > ?
        `,
        )
        .get(weekFromNow, now),
    );

    const recentCancellations = countFrom(
      await db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM subscriptions
          WHERE cancelled_at > ?
        `,
        )
        .get(weekAgo),
    );

    const inGracePeriod = countFrom(
      await db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM subscriptions
          WHERE grace_period_expires_at > ? AND status != 'active'
        `,
        )
        .get(now),
    );

    return {
      activeSubscriptions: byTier,
      trialCount,
      expiringThisWeek,
      recentCancellations,
      inGracePeriod,
    };
  }

  async function getLatestSubscriptionForUser(userId) {
    return db
      .prepare(
        `
        SELECT *
        FROM subscriptions
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      )
      .get(userId);
  }

  async function listRecentReceiptsForUser({ userId, limit = 20 } = {}) {
    return db
      .prepare(
        `
        SELECT
          transaction_id,
          original_transaction_id,
          product_id,
          platform,
          verification_status,
          purchase_date,
          expires_date,
          created_at
        FROM purchase_receipts
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(userId, limit);
  }

  async function getWebhookHealth({ since }) {
    const lastWebhook = await db
      .prepare(
        `SELECT created_at
         FROM audit_logs
         WHERE action LIKE 'webhook_%'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get();

    const webhooksByType = await db
      .prepare(
        `SELECT action as webhook_type, COUNT(*) as count
         FROM audit_logs
         WHERE action LIKE 'webhook_%' AND created_at > ?
         GROUP BY action`,
      )
      .all(since);

    const failedWebhooks = countFrom(
      await db
        .prepare(
          `SELECT COUNT(*) as count
           FROM audit_logs
           WHERE action LIKE 'webhook_%'
             AND created_at > ?
             AND metadata_json LIKE '%"error"%'`,
        )
        .get(since),
    );

    return {
      lastWebhookReceived: lastWebhook?.created_at || null,
      webhooksByType: webhooksByType.map((row) => ({
        ...row,
        count: Number(row.count || 0),
      })),
      failedWebhooks,
    };
  }

  return {
    getGiftBundleById,
    listGiftBundleProducts,
    listGiftBundlesForAdmin,
    resetPreviewCount,
    listPlanProducts,
    listReceiptSaleRows,
    countCurrentSubscribers,
    listCurrentSubscribers,
    listSubscriptionsByTierSince,
    getTrialConversionStatsSince,
    countCancelledSubscriptionsSince,
    countActiveSubscriptions,
    getSubscriptionHealthCounts,
    getLatestSubscriptionForUser,
    listRecentReceiptsForUser,
    getWebhookHealth,
    updateGiftBundleFields,
  };
}

module.exports = {
  createAdminBillingRepository,
};
