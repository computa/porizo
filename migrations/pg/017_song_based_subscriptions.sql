-- Migration: Song-based subscription model
-- Converts from credit-based to song-based billing
-- Adds admin-configurable plans and trial system

-- Subscription plans (admin configurable)
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  songs_per_month INTEGER NOT NULL,
  previews_per_day INTEGER NOT NULL DEFAULT -1,
  price_monthly_cents INTEGER,
  price_annual_cents INTEGER,
  description TEXT,
  features_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Map plan IDs to App Store / Play Store product IDs
CREATE TABLE IF NOT EXISTS plan_products (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  product_id TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(platform, product_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_products_plan_id ON plan_products(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_products_platform ON plan_products(platform, product_id);

-- Trial configuration (admin configurable, singleton)
CREATE TABLE IF NOT EXISTS trial_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  songs_allowed INTEGER NOT NULL DEFAULT 2,
  duration_days INTEGER NOT NULL DEFAULT 7,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Add song-based columns to entitlements
-- Keep credits_* for backward compatibility during migration
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS songs_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS songs_allowance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS songs_used_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS trial_songs_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS trial_expires_at TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS trial_started_at TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS plan_id TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS billing_period TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS subscription_starts_at TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS subscription_renews_at TEXT;

-- Add environment to subscriptions for distinguishing sandbox vs production
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0;

-- Song transactions (audit trail for song usage)
-- Separate from credit_transactions to maintain history
CREATE TABLE IF NOT EXISTS song_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source TEXT,
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_song_transactions_user_id ON song_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_song_transactions_type ON song_transactions(type);
CREATE INDEX IF NOT EXISTS idx_song_transactions_reference ON song_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_song_transactions_created ON song_transactions(user_id, created_at);

-- Webhook notification tracking (idempotency)
CREATE TABLE IF NOT EXISTS webhook_notifications (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  notification_uuid TEXT NOT NULL,
  subscription_id TEXT,
  user_id TEXT,
  payload_json TEXT,
  processed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(platform, notification_uuid)
);

CREATE INDEX IF NOT EXISTS idx_webhook_notifications_subscription ON webhook_notifications(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_notifications_user ON webhook_notifications(user_id);

-- Insert default plans
INSERT INTO subscription_plans (id, name, tier, songs_per_month, previews_per_day, price_monthly_cents, price_annual_cents, description, features_json, is_active, sort_order, created_at, updated_at)
VALUES
  ('free', 'Free', 'free', 0, 5, 0, 0, 'Try Porizo with limited previews', '["5 previews per day","No full songs"]', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plus', 'Plus', 'plus', 4, 20, 999, 9999, 'Perfect for occasional gifting', '["4 songs per month","20 previews per day","All occasions","All music styles"]', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pro', 'Pro', 'pro', 10, -1, 1499, 14999, 'For power users and families', '["10 songs per month","Unlimited previews","All occasions","All music styles","Priority processing"]', 1, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

-- Insert default plan products (Apple)
INSERT INTO plan_products (id, plan_id, platform, product_id, billing_period, created_at)
VALUES
  ('apple_plus_monthly', 'plus', 'apple', 'com.porizo.plus_monthly', 'monthly', CURRENT_TIMESTAMP),
  ('apple_plus_annual', 'plus', 'apple', 'com.porizo.plus_annual', 'annual', CURRENT_TIMESTAMP),
  ('apple_pro_monthly', 'pro', 'apple', 'com.porizo.pro_monthly', 'monthly', CURRENT_TIMESTAMP),
  ('apple_pro_annual', 'pro', 'apple', 'com.porizo.pro_annual', 'annual', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

-- Insert default plan products (Google)
INSERT INTO plan_products (id, plan_id, platform, product_id, billing_period, created_at)
VALUES
  ('google_plus_monthly', 'plus', 'google', 'plus_monthly', 'monthly', CURRENT_TIMESTAMP),
  ('google_plus_annual', 'plus', 'google', 'plus_annual', 'annual', CURRENT_TIMESTAMP),
  ('google_pro_monthly', 'pro', 'google', 'pro_monthly', 'monthly', CURRENT_TIMESTAMP),
  ('google_pro_annual', 'pro', 'google', 'pro_annual', 'annual', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

-- Insert default trial config
INSERT INTO trial_config (id, songs_allowed, duration_days, is_active, updated_at)
VALUES (1, 2, 7, 1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
