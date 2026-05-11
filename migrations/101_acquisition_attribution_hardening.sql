-- Acquisition attribution hardening.
-- Stores enough first-touch detail to compare Apple Ads, web landing pages,
-- email, social, and recipient-loop installs beyond source/campaign/country.

ALTER TABLE users ADD COLUMN acquisition_medium TEXT;
ALTER TABLE users ADD COLUMN acquisition_content TEXT;
ALTER TABLE users ADD COLUMN acquisition_term TEXT;
ALTER TABLE users ADD COLUMN acquisition_referrer TEXT;
ALTER TABLE users ADD COLUMN acquisition_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_acquisition_source_campaign
  ON users(acquisition_source, acquisition_campaign);

CREATE INDEX IF NOT EXISTS idx_apple_ads_attribution_campaign_ids
  ON apple_ads_attribution(campaign_id, ad_group_id, keyword_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_download_events_utm_campaign_created
  ON download_events(utm_campaign, created_at DESC);
