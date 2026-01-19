-- Migration: Add UTM tracking and attribution columns to share_tokens
-- This enables growth/marketing attribution for share links.

-- UTM parameters for campaign tracking
ALTER TABLE share_tokens ADD COLUMN utm_source TEXT;
ALTER TABLE share_tokens ADD COLUMN utm_medium TEXT;
ALTER TABLE share_tokens ADD COLUMN utm_campaign TEXT;

-- Additional attribution data
ALTER TABLE share_tokens ADD COLUMN referrer TEXT;
ALTER TABLE share_tokens ADD COLUMN created_ip TEXT;
ALTER TABLE share_tokens ADD COLUMN created_user_agent TEXT;

-- Index for UTM-based queries (attribution reports)
CREATE INDEX IF NOT EXISTS idx_share_tokens_utm_source ON share_tokens(utm_source);
CREATE INDEX IF NOT EXISTS idx_share_tokens_utm_campaign ON share_tokens(utm_campaign);
