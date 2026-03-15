-- Demo share links for marketing
-- Adds share_type column to distinguish normal shares from permanent demo shares
-- Demo shares: never expire, cannot be claimed, no PIN required

ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS share_type TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE poem_share_tokens ADD COLUMN IF NOT EXISTS share_type TEXT NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_share_tokens_type ON share_tokens(share_type);
CREATE INDEX IF NOT EXISTS idx_poem_share_tokens_type ON poem_share_tokens(share_type);
