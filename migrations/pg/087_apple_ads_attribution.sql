CREATE TABLE IF NOT EXISTS apple_ads_attribution (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  attribution_token_sha256 TEXT NOT NULL UNIQUE,
  token_length INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  api_status_code INTEGER,
  campaign_id BIGINT,
  ad_group_id BIGINT,
  keyword_id BIGINT,
  org_id BIGINT,
  conversion_type TEXT,
  country_or_region TEXT,
  click_date TEXT,
  impression_date TEXT,
  is_redownload BOOLEAN,
  raw_response_json TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_apple_ads_attribution_user_id
  ON apple_ads_attribution(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_apple_ads_attribution_status
  ON apple_ads_attribution(status, created_at DESC);
