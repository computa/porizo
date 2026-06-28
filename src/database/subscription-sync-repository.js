"use strict";

function createSubscriptionSyncRepository(db) {
  async function listPendingRenewalSubscriptions({
    cursor = "",
    now,
    limit,
  }) {
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
    return stmt.all(cursor, now, now, limit);
  }

  async function listExpiredGracePeriodSubscriptions({ now }) {
    const stmt = await db.prepare(`
      SELECT id FROM subscriptions
      WHERE status = 'grace_period'
        AND grace_period_expires_at IS NOT NULL
        AND grace_period_expires_at < ?
    `);
    return stmt.all(now);
  }

  return {
    listPendingRenewalSubscriptions,
    listExpiredGracePeriodSubscriptions,
  };
}

module.exports = { createSubscriptionSyncRepository };
