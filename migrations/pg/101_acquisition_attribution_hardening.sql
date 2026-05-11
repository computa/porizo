-- Acquisition attribution hardening.
-- Keep this migration idempotent because some production environments were
-- bootstrapped before the pg/071 download-attribution migration existed.

CREATE TABLE IF NOT EXISTS download_events (
  id TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  country TEXT,
  referrer_url TEXT,
  matched_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_download_events_ip_created
  ON download_events (ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_download_events_matched_user
  ON download_events (matched_user_id)
  WHERE matched_user_id IS NOT NULL;

ALTER TABLE download_events ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS referrer_url TEXT;
ALTER TABLE download_events ADD COLUMN IF NOT EXISTS matched_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_campaign TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_medium TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_content TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_term TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_referrer TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_acquisition_source_campaign
  ON users(acquisition_source, acquisition_campaign);

CREATE INDEX IF NOT EXISTS idx_apple_ads_attribution_campaign_ids
  ON apple_ads_attribution(campaign_id, ad_group_id, keyword_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_download_events_utm_campaign_created
  ON download_events(utm_campaign, created_at DESC);
