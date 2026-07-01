/**
 * Compute Daily Aggregates Job
 *
 * Computes daily aggregates from raw tables for dashboard read models.
 * Triggered on-demand when admin views the KPI dashboard.
 */

const crypto = require("crypto");
const {
  createDailyAggregatesRepository,
} = require("../database/daily-aggregates-repository");

/**
 * Generate a unique aggregate ID
 */
function generateAggregateId() {
  return `agg_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Compute daily aggregates for a specific date
 * @param {Object} db - Database instance
 * @param {string} dateStr - Date string in YYYY-MM-DD format (defaults to yesterday)
 * @returns {Object} The computed aggregate record
 */
async function computeDailyAggregates(db, dateStr = null) {
  const dailyAggregatesRepository = createDailyAggregatesRepository(db);

  // Default to yesterday if no date provided
  if (!dateStr) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    dateStr = yesterday.toISOString().split("T")[0];
  }

  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;
  const weekAgo = new Date(new Date(dateStr).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(new Date(dateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const metrics = await dailyAggregatesRepository.getDailyMetricInputs({
    dayStart,
    dayEnd,
    weekAgo,
    monthAgo,
  });

  const now = new Date().toISOString();
  const existing =
    await dailyAggregatesRepository.findAggregateIdentityByDate(dateStr);

  const aggregate = {
    id: existing?.id || generateAggregateId(),
    date: dateStr,
    dau: metrics.dau,
    wau: metrics.wau,
    mau: metrics.mau,
    new_users: metrics.newUsers,
    active_subscriptions: metrics.activeSubscriptions,
    new_subscriptions: metrics.newSubscriptions,
    cancellations: metrics.cancellations,
    trial_starts: metrics.trialStarts,
    trial_conversions: metrics.trialConversions,
    revenue_cents: metrics.revenueCents,
    renders_started: metrics.rendersStarted,
    renders_completed: metrics.rendersCompleted,
    shares_created: metrics.sharesCreated,
    shares_claimed: metrics.sharesClaimed,
    teaser_views: metrics.teaserViews,
    stories_started: metrics.storiesStarted,
    stories_confirmed: metrics.storiesConfirmed,
    computed_at: now,
  };

  return dailyAggregatesRepository.upsertDailyAggregate(aggregate);
}

/**
 * Ensure aggregates exist for the last N days
 * Called on-demand when admin views dashboard
 * @param {Object} db - Database instance
 * @param {number} days - Number of days to ensure aggregates for
 */
async function ensureRecentAggregates(db, days = 30) {
  const dailyAggregatesRepository = createDailyAggregatesRepository(db);
  const results = [];

  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];

    // Check if aggregate exists and is fresh (computed within last hour)
    const existing =
      await dailyAggregatesRepository.findAggregateFreshness(dateStr);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Recompute if missing or stale (for recent days only)
    const isRecent = i <= 3; // Only recompute last 3 days
    const isStale = existing && existing.computed_at < oneHourAgo;

    if (!existing || (isRecent && isStale)) {
      await computeDailyAggregates(db, dateStr);
      results.push({ date: dateStr, action: existing ? "updated" : "created" });
    }
  }

  return results;
}

/**
 * Get aggregates for KPI dashboard
 * @param {Object} db - Database instance
 * @param {number} days - Number of days to return
 */
async function getKPIAggregates(db, days = 30) {
  const dailyAggregatesRepository = createDailyAggregatesRepository(db);

  // Ensure we have recent data
  await ensureRecentAggregates(db, days);

  // Calculate cutoff date in JS for consistent date handling
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  return dailyAggregatesRepository.listAggregatesSince(cutoffStr);
}

/**
 * Calculate week-over-week trends
 * @param {Object} db - Database instance
 */
async function getKPITrends(db, now = new Date()) {
  const dailyAggregatesRepository = createDailyAggregatesRepository(db);

  // Calculate date boundaries in JS for consistent date handling
  const today = new Date(now);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(today.getDate() - 14);

  const weekAgoStr = weekAgo.toISOString().split("T")[0];
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split("T")[0];

  const thisWeek = await dailyAggregatesRepository.sumKpiTotalsSince(weekAgoStr);
  const lastWeek = await dailyAggregatesRepository.sumKpiTotalsBetween(
    twoWeeksAgoStr,
    weekAgoStr,
  );

  // Calculate percentage changes (handle string values from PostgreSQL)
  const calcChange = (current, previous) => {
    const curr = Number(current) || 0;
    const prev = Number(previous) || 0;
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev * 100).toFixed(1);
  };

  return {
    thisWeek,
    lastWeek,
    changes: {
      dau: calcChange(thisWeek.total_dau || 0, lastWeek.total_dau || 0),
      newUsers: calcChange(thisWeek.total_new_users || 0, lastWeek.total_new_users || 0),
      renders: calcChange(thisWeek.total_renders || 0, lastWeek.total_renders || 0),
      shares: calcChange(thisWeek.total_shares || 0, lastWeek.total_shares || 0),
      revenue: calcChange(thisWeek.total_revenue || 0, lastWeek.total_revenue || 0),
    },
  };
}

module.exports = {
  computeDailyAggregates,
  ensureRecentAggregates,
  getKPIAggregates,
  getKPITrends,
};
