CREATE TABLE IF NOT EXISTS apple_ads_keyword_map (
  keyword_id TEXT PRIMARY KEY,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_group_id TEXT,
  ad_group_name TEXT,
  keyword_text TEXT NOT NULL,
  match_type TEXT,
  bid_amount TEXT,
  status TEXT,
  source TEXT NOT NULL DEFAULT 'apple_ads_api',
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apple_ads_keyword_map_campaign
  ON apple_ads_keyword_map(campaign_id, ad_group_id);

CREATE INDEX IF NOT EXISTS idx_apple_ads_keyword_map_text
  ON apple_ads_keyword_map(keyword_text, match_type);
