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

-- Add share_token_id and audio_generated_at columns to poems if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='poems' AND column_name='share_token_id')
  THEN ALTER TABLE poems ADD COLUMN share_token_id TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='poems' AND column_name='audio_generated_at')
  THEN ALTER TABLE poems ADD COLUMN audio_generated_at TIMESTAMPTZ; END IF;
END $$;
