-- Auth/account hardening support tables (Postgres)

CREATE TABLE IF NOT EXISTS auth_social_challenges (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_social_challenges_lookup
  ON auth_social_challenges (provider, nonce_hash, consumed_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_social_challenges_expires
  ON auth_social_challenges (expires_at);

CREATE TABLE IF NOT EXISTS account_deletion_storage_cleanup_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  storage_prefixes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  locked_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_cleanup_due
  ON account_deletion_storage_cleanup_jobs (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_account_deletion_cleanup_user
  ON account_deletion_storage_cleanup_jobs (user_id);
