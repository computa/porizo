-- Durable post-commit cleanup for external account artifacts (PostgreSQL).
CREATE TABLE IF NOT EXISTS account_cleanup_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'retry', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_cleanup_jobs_claim_idx
  ON account_cleanup_jobs(status, next_attempt_at, lease_expires_at, created_at);
