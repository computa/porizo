-- Migration 032: Add webhook dead-letter queue
-- Captures failed webhook notifications for debugging and retry

CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK(platform IN ('apple', 'google')),
  notification_type TEXT NOT NULL,
  notification_uuid TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  first_failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reprocessed_at TEXT,
  reprocess_result TEXT,

  -- Prevent duplicate DLQ entries for the same notification
  UNIQUE(platform, notification_uuid)
);

-- Index for efficient listing of unprocessed failures
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_unprocessed
  ON webhook_dead_letter_queue(platform, reprocessed_at)
  WHERE reprocessed_at IS NULL;

-- Index for cleanup of old reprocessed entries
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_reprocessed
  ON webhook_dead_letter_queue(reprocessed_at)
  WHERE reprocessed_at IS NOT NULL;

-- Add status column to webhook_notifications if it doesn't exist
-- This tracks pending/processing/completed/failed states
ALTER TABLE webhook_notifications ADD COLUMN status TEXT DEFAULT 'completed';
