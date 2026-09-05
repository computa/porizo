CREATE TABLE IF NOT EXISTS etsy_oauth_authorizations (
  state_hash TEXT PRIMARY KEY,
  verifier_encrypted TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_etsy_oauth_authorizations_expires_at
  ON etsy_oauth_authorizations(expires_at);
