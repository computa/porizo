-- Download attribution tracking
-- Logs every /download hit with UTM params and country for acquisition attribution

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_download_events_ip_created
  ON download_events (ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_download_events_matched_user
  ON download_events (matched_user_id)
  WHERE matched_user_id IS NOT NULL;

-- Attribution columns on users
ALTER TABLE users ADD COLUMN acquisition_source TEXT;
ALTER TABLE users ADD COLUMN acquisition_campaign TEXT;
ALTER TABLE users ADD COLUMN acquisition_country TEXT;
