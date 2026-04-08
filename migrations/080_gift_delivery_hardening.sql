-- Migration 080: Harden scheduled gift delivery lifecycle

-- Allow multiple share rows per asset so gift delivery can use immutable per-gift tokens.
DROP INDEX IF EXISTS idx_share_tokens_track;
DROP INDEX IF EXISTS idx_poem_share_tokens_poem;

CREATE INDEX IF NOT EXISTS idx_share_tokens_track
  ON share_tokens(track_id);

CREATE INDEX IF NOT EXISTS idx_poem_share_tokens_poem
  ON poem_share_tokens(poem_id);

-- Persist dispatch timing and frozen content snapshots on gift orders.
ALTER TABLE gift_orders ADD COLUMN content_snapshot_json TEXT;
ALTER TABLE gift_orders ADD COLUMN next_retry_at TEXT;
ALTER TABLE gift_orders ADD COLUMN dispatch_started_at TEXT;

UPDATE gift_orders
SET next_retry_at = send_at
WHERE next_retry_at IS NULL;
