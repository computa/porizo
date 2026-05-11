CREATE TABLE IF NOT EXISTS receiver_sessions (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('song', 'poem')),
  receiver_handoff_id TEXT UNIQUE,
  receiver_session_secret_hash TEXT,
  receiver_claim_token_hash TEXT UNIQUE,
  handoff_expires_at TEXT,
  handoff_resolved_at TEXT,
  claim_token_expires_at TEXT,
  download_attributed_at TEXT,
  first_event_name TEXT,
  last_event_name TEXT,
  first_ip_address TEXT,
  last_ip_address TEXT,
  first_user_agent TEXT,
  last_user_agent TEXT,
  appsflyer_click_id TEXT,
  matched_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receiver_sessions_share
  ON receiver_sessions (share_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receiver_sessions_handoff
  ON receiver_sessions (receiver_handoff_id);

CREATE INDEX IF NOT EXISTS idx_receiver_sessions_claim_token
  ON receiver_sessions (receiver_claim_token_hash);

CREATE INDEX IF NOT EXISTS idx_receiver_sessions_matched_user
  ON receiver_sessions (matched_user_id)
  WHERE matched_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS receiver_session_events (
  id TEXT PRIMARY KEY,
  receiver_session_id TEXT NOT NULL REFERENCES receiver_sessions(id) ON DELETE CASCADE,
  share_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  metadata_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receiver_session_events_session
  ON receiver_session_events (receiver_session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_receiver_session_events_name_created
  ON receiver_session_events (event_name, created_at DESC);

ALTER TABLE download_events ADD COLUMN receiver_session_id TEXT;

UPDATE share_tokens
SET web_stream_allowed = 1
WHERE delivery_source = 'gift'
  AND claim_policy = 'app_only'
  AND status = 'unbound'
  AND COALESCE(web_stream_allowed, 0) = 0;
