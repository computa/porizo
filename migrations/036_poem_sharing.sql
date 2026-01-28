-- Migration: Add poem sharing tables
-- Similar structure to share_tokens but for poems

CREATE TABLE IF NOT EXISTS poem_share_tokens (
  id TEXT PRIMARY KEY,
  poem_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  -- Recipient binding
  bound_device_id TEXT,
  bound_user_id TEXT,
  bound_at TEXT,
  -- Claim protection
  claim_pin TEXT,
  claim_attempts INTEGER NOT NULL DEFAULT 0,
  -- Permissions
  allow_save INTEGER NOT NULL DEFAULT 1,
  -- Expiration
  expires_at TEXT NOT NULL,
  -- Tracking
  created_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  -- Attribution
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  created_ip TEXT,
  created_user_agent TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_poem_share_tokens_poem
  ON poem_share_tokens (poem_id);

CREATE INDEX IF NOT EXISTS idx_poem_share_tokens_creator
  ON poem_share_tokens (creator_id);

CREATE INDEX IF NOT EXISTS idx_poem_share_tokens_status
  ON poem_share_tokens (status);

-- Access log for poem shares
CREATE TABLE IF NOT EXISTS poem_share_access_log (
  id TEXT PRIMARY KEY,
  poem_share_token_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_poem_share_access_token
  ON poem_share_access_log (poem_share_token_id);

-- Add share_token_id to poems table
ALTER TABLE poems ADD COLUMN share_token_id TEXT;
