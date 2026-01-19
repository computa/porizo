-- Migration: Daily aggregates table for dashboard read models
-- Pre-computed metrics for fast dashboard loading.
-- Computed on-demand when admin views dashboard (not via scheduled job).

CREATE TABLE IF NOT EXISTS daily_aggregates (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,

  -- User metrics
  dau INTEGER DEFAULT 0,           -- Daily active users
  wau INTEGER DEFAULT 0,           -- Weekly active users (rolling 7 days)
  mau INTEGER DEFAULT 0,           -- Monthly active users (rolling 30 days)
  new_users INTEGER DEFAULT 0,     -- New signups that day

  -- Subscription metrics
  active_subscriptions INTEGER DEFAULT 0,
  new_subscriptions INTEGER DEFAULT 0,
  cancellations INTEGER DEFAULT 0,
  trial_starts INTEGER DEFAULT 0,
  trial_conversions INTEGER DEFAULT 0,

  -- Revenue (stored in cents to avoid floating point issues)
  revenue_cents INTEGER DEFAULT 0,

  -- Engagement metrics
  renders_started INTEGER DEFAULT 0,
  renders_completed INTEGER DEFAULT 0,
  shares_created INTEGER DEFAULT 0,
  shares_claimed INTEGER DEFAULT 0,
  teaser_views INTEGER DEFAULT 0,

  -- Story metrics
  stories_started INTEGER DEFAULT 0,
  stories_confirmed INTEGER DEFAULT 0,

  -- Timestamps
  computed_at TEXT NOT NULL
);

-- Index for date-range queries (dashboards typically query last 30-90 days)
CREATE INDEX IF NOT EXISTS idx_daily_aggregates_date ON daily_aggregates(date);
