/**
 * Compute Daily Aggregates Job
 *
 * Computes daily aggregates from raw tables for dashboard read models.
 * Triggered on-demand when admin views the KPI dashboard.
 */

const crypto = require("crypto");

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
  // Default to yesterday if no date provided
  if (!dateStr) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    dateStr = yesterday.toISOString().split("T")[0];
  }

  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;
  const weekAgo = new Date(new Date(dateStr).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(new Date(dateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Check if already computed for this date
  const existing = await db.prepare("SELECT id FROM daily_aggregates WHERE date = ?").get(dateStr);

  // --- User metrics ---
  // DAU: Users with any activity that day (events or tracks created)
  const dau = (await db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count
    FROM events
    WHERE created_at >= ? AND created_at <= ? AND user_id IS NOT NULL
  `).get(dayStart, dayEnd))?.count ?? 0;

  // WAU: Rolling 7-day active users
  const wau = (await db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count
    FROM events
    WHERE created_at >= ? AND created_at <= ? AND user_id IS NOT NULL
  `).get(weekAgo, dayEnd))?.count ?? 0;

  // MAU: Rolling 30-day active users
  const mau = (await db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count
    FROM events
    WHERE created_at >= ? AND created_at <= ? AND user_id IS NOT NULL
  `).get(monthAgo, dayEnd))?.count ?? 0;

  // New users
  const newUsers = (await db.prepare(`
    SELECT COUNT(*) as count FROM users WHERE created_at >= ? AND created_at <= ?
  `).get(dayStart, dayEnd))?.count ?? 0;

  // --- Subscription metrics ---
  const activeSubscriptions = (await db.prepare(`
    SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'
  `).get())?.count ?? 0;

  const newSubscriptions = (await db.prepare(`
    SELECT COUNT(*) as count FROM subscriptions WHERE created_at >= ? AND created_at <= ?
  `).get(dayStart, dayEnd))?.count ?? 0;

  const cancellations = (await db.prepare(`
    SELECT COUNT(*) as count FROM subscriptions WHERE cancelled_at >= ? AND cancelled_at <= ?
  `).get(dayStart, dayEnd))?.count ?? 0;

  const trialStarts = (await db.prepare(`
    SELECT COUNT(*) as count FROM subscriptions WHERE status = 'trial' AND created_at >= ? AND created_at <= ?
  `).get(dayStart, dayEnd))?.count ?? 0;

  // Trial conversions: subscriptions that moved from trial to active that day
  const trialConversions = (await db.prepare(`
    SELECT COUNT(*) as count
    FROM subscriptions
    WHERE status = 'active' AND original_purchase_date >= ? AND original_purchase_date <= ?
  `).get(dayStart, dayEnd))?.count ?? 0;

  // --- Revenue ---
  const revenueCents = (await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM credit_transactions
    WHERE created_at >= ? AND created_at <= ? AND type IN ('purchase', 'subscription')
  `).get(dayStart, dayEnd))?.total ?? 0;

  // --- Engagement & Story metrics from events (batched into single query) ---
  const eventCounts = await db.prepare(`
    SELECT
      SUM(CASE WHEN event_name = 'render_start' THEN 1 ELSE 0 END) as renders_started,
      SUM(CASE WHEN event_name = 'render_ready' THEN 1 ELSE 0 END) as renders_completed,
      SUM(CASE WHEN event_name = 'share_create' THEN 1 ELSE 0 END) as shares_created,
      SUM(CASE WHEN event_name = 'share_claim' THEN 1 ELSE 0 END) as shares_claimed,
      SUM(CASE WHEN event_name = 'teaser_viewed' THEN 1 ELSE 0 END) as teaser_views,
      SUM(CASE WHEN event_name = 'story_start' THEN 1 ELSE 0 END) as stories_started,
      SUM(CASE WHEN event_name = 'story_confirm' THEN 1 ELSE 0 END) as stories_confirmed
    FROM events
    WHERE created_at >= ? AND created_at <= ?
  `).get(dayStart, dayEnd);

  const rendersStarted = Number(eventCounts?.renders_started) || 0;
  const rendersCompleted = Number(eventCounts?.renders_completed) || 0;
  const sharesCreated = Number(eventCounts?.shares_created) || 0;
  const sharesClaimed = Number(eventCounts?.shares_claimed) || 0;
  const teaserViews = Number(eventCounts?.teaser_views) || 0;
  const storiesStarted = Number(eventCounts?.stories_started) || 0;
  const storiesConfirmed = Number(eventCounts?.stories_confirmed) || 0;

  const now = new Date().toISOString();

  const aggregate = {
    id: existing?.id || generateAggregateId(),
    date: dateStr,
    dau,
    wau,
    mau,
    new_users: newUsers,
    active_subscriptions: activeSubscriptions,
    new_subscriptions: newSubscriptions,
    cancellations,
    trial_starts: trialStarts,
    trial_conversions: trialConversions,
    revenue_cents: revenueCents,
    renders_started: rendersStarted,
    renders_completed: rendersCompleted,
    shares_created: sharesCreated,
    shares_claimed: sharesClaimed,
    teaser_views: teaserViews,
    stories_started: storiesStarted,
    stories_confirmed: storiesConfirmed,
    computed_at: now,
  };

  // Upsert the aggregate
  if (existing) {
    await db.prepare(`
      UPDATE daily_aggregates SET
        dau = ?, wau = ?, mau = ?, new_users = ?,
        active_subscriptions = ?, new_subscriptions = ?, cancellations = ?,
        trial_starts = ?, trial_conversions = ?, revenue_cents = ?,
        renders_started = ?, renders_completed = ?, shares_created = ?,
        shares_claimed = ?, teaser_views = ?, stories_started = ?,
        stories_confirmed = ?, computed_at = ?
      WHERE id = ?
    `).run(
      dau, wau, mau, newUsers,
      activeSubscriptions, newSubscriptions, cancellations,
      trialStarts, trialConversions, revenueCents,
      rendersStarted, rendersCompleted, sharesCreated,
      sharesClaimed, teaserViews, storiesStarted,
      storiesConfirmed, now, existing.id
    );
  } else {
    await db.prepare(`
      INSERT INTO daily_aggregates (
        id, date, dau, wau, mau, new_users,
        active_subscriptions, new_subscriptions, cancellations,
        trial_starts, trial_conversions, revenue_cents,
        renders_started, renders_completed, shares_created,
        shares_claimed, teaser_views, stories_started,
        stories_confirmed, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      aggregate.id, dateStr, dau, wau, mau, newUsers,
      activeSubscriptions, newSubscriptions, cancellations,
      trialStarts, trialConversions, revenueCents,
      rendersStarted, rendersCompleted, sharesCreated,
      sharesClaimed, teaserViews, storiesStarted,
      storiesConfirmed, now
    );
  }

  return aggregate;
}

/**
 * Ensure aggregates exist for the last N days
 * Called on-demand when admin views dashboard
 * @param {Object} db - Database instance
 * @param {number} days - Number of days to ensure aggregates for
 */
async function ensureRecentAggregates(db, days = 30) {
  const results = [];

  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];

    // Check if aggregate exists and is fresh (computed within last hour)
    const existing = await db.prepare(`
      SELECT id, computed_at FROM daily_aggregates WHERE date = ?
    `).get(dateStr);

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
  // Ensure we have recent data
  await ensureRecentAggregates(db, days);

  // Calculate cutoff date in JS (works on both SQLite and PostgreSQL)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // Return aggregates
  return await db.prepare(`
    SELECT * FROM daily_aggregates
    WHERE date >= ?
    ORDER BY date DESC
  `).all(cutoffStr);
}

/**
 * Calculate week-over-week trends
 * @param {Object} db - Database instance
 */
async function getKPITrends(db) {
  // Calculate date boundaries in JS (works on both SQLite and PostgreSQL)
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(today.getDate() - 14);

  const weekAgoStr = weekAgo.toISOString().split("T")[0];
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split("T")[0];

  // This week's totals
  const thisWeek = await db.prepare(`
    SELECT
      SUM(dau) as total_dau,
      SUM(new_users) as total_new_users,
      SUM(renders_completed) as total_renders,
      SUM(shares_created) as total_shares,
      SUM(revenue_cents) as total_revenue
    FROM daily_aggregates
    WHERE date >= ?
  `).get(weekAgoStr);

  // Last week's totals
  const lastWeek = await db.prepare(`
    SELECT
      SUM(dau) as total_dau,
      SUM(new_users) as total_new_users,
      SUM(renders_completed) as total_renders,
      SUM(shares_created) as total_shares,
      SUM(revenue_cents) as total_revenue
    FROM daily_aggregates
    WHERE date >= ? AND date < ?
  `).get(twoWeeksAgoStr, weekAgoStr);

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
