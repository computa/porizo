CREATE TABLE IF NOT EXISTS receiver_claim_tokens (
  token_hash TEXT PRIMARY KEY,
  receiver_session_id TEXT NOT NULL REFERENCES receiver_sessions(id) ON DELETE CASCADE,
  share_id TEXT NOT NULL,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('song', 'poem')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receiver_claim_tokens_session
  ON receiver_claim_tokens (receiver_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receiver_claim_tokens_share
  ON receiver_claim_tokens (share_id, created_at DESC);
