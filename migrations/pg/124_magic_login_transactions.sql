CREATE TABLE IF NOT EXISTS magic_login_transactions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'register', 'add_email')),
  email_normalized TEXT NOT NULL,
  account_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  link_secret_hash TEXT NOT NULL,
  request_secret_hash TEXT NOT NULL,
  requester_key_hash TEXT NOT NULL,
  ip_address_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'locked', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  session_id TEXT,
  recovery_request_hash TEXT,
  recovery_result_json JSONB,
  recovery_expires_at TIMESTAMPTZ,
  recovery_claimed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (purpose = 'add_email' OR account_id IS NULL),
  CHECK (purpose != 'add_email' OR account_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_magic_login_active_email
  ON magic_login_transactions (email_normalized, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_magic_login_active_requester
  ON magic_login_transactions (requester_key_hash, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_magic_login_active_account
  ON magic_login_transactions (account_id, expires_at)
  WHERE status = 'pending' AND account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_magic_login_active_ip
  ON magic_login_transactions (ip_address_hash, expires_at)
  WHERE status = 'pending' AND ip_address_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_magic_login_cleanup
  ON magic_login_transactions (expires_at, recovery_expires_at);
