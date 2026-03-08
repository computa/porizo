-- 036_poem_sharing.sql
-- Creates poem sharing tables (poem_share_tokens + access log)
-- and adds missing columns to poems table.
-- Fills the gap between 035_rate_limits_bigint and 037_phone_auth.

CREATE TABLE IF NOT EXISTS poem_share_tokens (
  id TEXT PRIMARY KEY,
  poem_id TEXT NOT NULL REFERENCES poems(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  bound_user_id TEXT,
  bound_at TIMESTAMPTZ,
  claim_pin TEXT,
  claim_attempts INTEGER NOT NULL DEFAULT 0,
  allow_save BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  created_ip TEXT,
  created_user_agent TEXT
);

CREATE TABLE IF NOT EXISTS poem_share_access_log (
  id TEXT PRIMARY KEY,
  poem_share_token_id TEXT NOT NULL REFERENCES poem_share_tokens(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep these as standalone ALTER statements because the migration runner
-- tokenizes SQL on semicolons and cannot safely execute DO blocks.
ALTER TABLE poems ADD COLUMN IF NOT EXISTS share_token_id TEXT;
ALTER TABLE poems ADD COLUMN IF NOT EXISTS audio_generated_at TIMESTAMPTZ;
