"use strict";

function countValue(row) {
  return Number(row?.count || 0);
}

function numericValue(value) {
  return Number(value || 0);
}

function normalizeTrendTotals(row) {
  return {
    total_dau: numericValue(row?.total_dau),
    total_new_users: numericValue(row?.total_new_users),
    total_renders: numericValue(row?.total_renders),
    total_shares: numericValue(row?.total_shares),
    total_revenue: numericValue(row?.total_revenue),
  };
}

function normalizeAggregate(row) {
  if (!row) return null;
  return {
    ...row,
    dau: numericValue(row.dau),
    wau: numericValue(row.wau),
    mau: numericValue(row.mau),
    new_users: numericValue(row.new_users),
    active_subscriptions: numericValue(row.active_subscriptions),
    new_subscriptions: numericValue(row.new_subscriptions),
    cancellations: numericValue(row.cancellations),
    trial_starts: numericValue(row.trial_starts),
    trial_conversions: numericValue(row.trial_conversions),
    revenue_cents: numericValue(row.revenue_cents),
    renders_started: numericValue(row.renders_started),
    renders_completed: numericValue(row.renders_completed),
    shares_created: numericValue(row.shares_created),
    shares_claimed: numericValue(row.shares_claimed),
    teaser_views: numericValue(row.teaser_views),
    stories_started: numericValue(row.stories_started),
    stories_confirmed: numericValue(row.stories_confirmed),
  };
}

function createDailyAggregatesRepository(db) {
  async function findAggregateIdentityByDate(date) {
    return db
      .prepare("SELECT id FROM daily_aggregates WHERE date = ?")
      .get(date);
  }

  async function getDailyMetricInputs({ dayStart, dayEnd, weekAgo, monthAgo }) {
    const dau = countValue(
      await db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) as count
          FROM events
          WHERE created_at >= ? AND created_at <= ? AND user_id IS NOT NULL`,
        )
        .get(dayStart, dayEnd),
    );

    const wau = countValue(
      await db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) as count
          FROM events
          WHERE created_at >= ? AND created_at <= ? AND user_id IS NOT NULL`,
        )
        .get(weekAgo, dayEnd),
    );

    const mau = countValue(
      await db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) as count
          FROM events
          WHERE created_at >= ? AND created_at <= ? AND user_id IS NOT NULL`,
        )
        .get(monthAgo, dayEnd),
    );

    const newUsers = countValue(
      await db
        .prepare(
          "SELECT COUNT(*) as count FROM users WHERE created_at >= ? AND created_at <= ?",
        )
        .get(dayStart, dayEnd),
    );

    const activeSubscriptions = countValue(
      await db
        .prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'")
        .get(),
    );

    const newSubscriptions = countValue(
      await db
        .prepare(
          "SELECT COUNT(*) as count FROM subscriptions WHERE created_at >= ? AND created_at <= ?",
        )
        .get(dayStart, dayEnd),
    );

    const cancellations = countValue(
      await db
        .prepare(
          "SELECT COUNT(*) as count FROM subscriptions WHERE cancelled_at >= ? AND cancelled_at <= ?",
        )
        .get(dayStart, dayEnd),
    );

    const trialStarts = countValue(
      await db
        .prepare(
          "SELECT COUNT(*) as count FROM subscriptions WHERE status = 'trial' AND created_at >= ? AND created_at <= ?",
        )
        .get(dayStart, dayEnd),
    );

    const trialConversions = countValue(
      await db
        .prepare(
          `SELECT COUNT(*) as count
          FROM subscriptions
          WHERE status = 'active' AND original_purchase_date >= ? AND original_purchase_date <= ?`,
        )
        .get(dayStart, dayEnd),
    );

    const revenueCents = numericValue(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) as total
            FROM credit_transactions
            WHERE created_at >= ? AND created_at <= ? AND type IN ('purchase', 'subscription')`,
          )
          .get(dayStart, dayEnd)
      )?.total,
    );

    const eventCounts = await db
      .prepare(
        `SELECT
          SUM(CASE WHEN event_name = 'render_start' THEN 1 ELSE 0 END) as renders_started,
          SUM(CASE WHEN event_name = 'render_ready' THEN 1 ELSE 0 END) as renders_completed,
          SUM(CASE WHEN event_name = 'share_create' THEN 1 ELSE 0 END) as shares_created,
          SUM(CASE WHEN event_name = 'share_claim' THEN 1 ELSE 0 END) as shares_claimed,
          SUM(CASE WHEN event_name = 'teaser_viewed' THEN 1 ELSE 0 END) as teaser_views,
          SUM(CASE WHEN event_name = 'story_start' THEN 1 ELSE 0 END) as stories_started,
          SUM(CASE WHEN event_name = 'story_confirm' THEN 1 ELSE 0 END) as stories_confirmed
        FROM events
        WHERE created_at >= ? AND created_at <= ?`,
      )
      .get(dayStart, dayEnd);

    return {
      dau,
      wau,
      mau,
      newUsers,
      activeSubscriptions,
      newSubscriptions,
      cancellations,
      trialStarts,
      trialConversions,
      revenueCents,
      rendersStarted: numericValue(eventCounts?.renders_started),
      rendersCompleted: numericValue(eventCounts?.renders_completed),
      sharesCreated: numericValue(eventCounts?.shares_created),
      sharesClaimed: numericValue(eventCounts?.shares_claimed),
      teaserViews: numericValue(eventCounts?.teaser_views),
      storiesStarted: numericValue(eventCounts?.stories_started),
      storiesConfirmed: numericValue(eventCounts?.stories_confirmed),
    };
  }

  async function upsertDailyAggregate(aggregate) {
    const existing = await findAggregateIdentityByDate(aggregate.date);
    if (existing) {
      await db
        .prepare(
          `UPDATE daily_aggregates SET
            dau = ?, wau = ?, mau = ?, new_users = ?,
            active_subscriptions = ?, new_subscriptions = ?, cancellations = ?,
            trial_starts = ?, trial_conversions = ?, revenue_cents = ?,
            renders_started = ?, renders_completed = ?, shares_created = ?,
            shares_claimed = ?, teaser_views = ?, stories_started = ?,
            stories_confirmed = ?, computed_at = ?
          WHERE id = ?`,
        )
        .run(
          aggregate.dau,
          aggregate.wau,
          aggregate.mau,
          aggregate.new_users,
          aggregate.active_subscriptions,
          aggregate.new_subscriptions,
          aggregate.cancellations,
          aggregate.trial_starts,
          aggregate.trial_conversions,
          aggregate.revenue_cents,
          aggregate.renders_started,
          aggregate.renders_completed,
          aggregate.shares_created,
          aggregate.shares_claimed,
          aggregate.teaser_views,
          aggregate.stories_started,
          aggregate.stories_confirmed,
          aggregate.computed_at,
          existing.id,
        );
      return { ...aggregate, id: existing.id };
    }

    await db
      .prepare(
        `INSERT INTO daily_aggregates (
          id, date, dau, wau, mau, new_users,
          active_subscriptions, new_subscriptions, cancellations,
          trial_starts, trial_conversions, revenue_cents,
          renders_started, renders_completed, shares_created,
          shares_claimed, teaser_views, stories_started,
          stories_confirmed, computed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        aggregate.id,
        aggregate.date,
        aggregate.dau,
        aggregate.wau,
        aggregate.mau,
        aggregate.new_users,
        aggregate.active_subscriptions,
        aggregate.new_subscriptions,
        aggregate.cancellations,
        aggregate.trial_starts,
        aggregate.trial_conversions,
        aggregate.revenue_cents,
        aggregate.renders_started,
        aggregate.renders_completed,
        aggregate.shares_created,
        aggregate.shares_claimed,
        aggregate.teaser_views,
        aggregate.stories_started,
        aggregate.stories_confirmed,
        aggregate.computed_at,
      );
    return aggregate;
  }

  async function findAggregateFreshness(date) {
    return db
      .prepare("SELECT id, computed_at FROM daily_aggregates WHERE date = ?")
      .get(date);
  }

  async function listAggregatesSince(date) {
    const rows = await db
      .prepare(
        `SELECT * FROM daily_aggregates
        WHERE date >= ?
        ORDER BY date DESC`,
      )
      .all(date);
    return rows.map(normalizeAggregate);
  }

  async function sumKpiTotalsSince(date) {
    const row = await db
      .prepare(
        `SELECT
          SUM(dau) as total_dau,
          SUM(new_users) as total_new_users,
          SUM(renders_completed) as total_renders,
          SUM(shares_created) as total_shares,
          SUM(revenue_cents) as total_revenue
        FROM daily_aggregates
        WHERE date >= ?`,
      )
      .get(date);
    return normalizeTrendTotals(row);
  }

  async function sumKpiTotalsBetween(startDate, endDate) {
    const row = await db
      .prepare(
        `SELECT
          SUM(dau) as total_dau,
          SUM(new_users) as total_new_users,
          SUM(renders_completed) as total_renders,
          SUM(shares_created) as total_shares,
          SUM(revenue_cents) as total_revenue
        FROM daily_aggregates
        WHERE date >= ? AND date < ?`,
      )
      .get(startDate, endDate);
    return normalizeTrendTotals(row);
  }

  return {
    findAggregateFreshness,
    findAggregateIdentityByDate,
    getDailyMetricInputs,
    listAggregatesSince,
    sumKpiTotalsBetween,
    sumKpiTotalsSince,
    upsertDailyAggregate,
  };
}

module.exports = {
  createDailyAggregatesRepository,
};
