-- Durable post-commit cleanup for external account artifacts (SQLite test mirror).
CREATE TABLE IF NOT EXISTS account_cleanup_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'retry', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS account_cleanup_jobs_claim_idx
  ON account_cleanup_jobs(status, next_attempt_at, lease_expires_at, created_at);
