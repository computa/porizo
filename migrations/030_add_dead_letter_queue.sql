-- Dead Letter Queue (DLQ) table for failed jobs
-- Captures jobs that have exceeded max retries for debugging and reprocessing

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  original_status TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  moved_at TEXT NOT NULL DEFAULT (datetime('now')),
  reprocessed_at TEXT,
  reprocess_job_id TEXT REFERENCES jobs(id),

  -- Prevent duplicate DLQ entries for the same job
  UNIQUE(job_id)
);

-- Index for efficient listing of unprocessed entries
CREATE INDEX IF NOT EXISTS idx_dlq_unprocessed
  ON dead_letter_queue(reprocessed_at)
  WHERE reprocessed_at IS NULL;

-- Index for cleanup of old reprocessed entries
CREATE INDEX IF NOT EXISTS idx_dlq_reprocessed_at
  ON dead_letter_queue(reprocessed_at)
  WHERE reprocessed_at IS NOT NULL;

-- Add dead_letter status to jobs if not already present
-- (SQLite doesn't support ALTER TABLE ADD CHECK, status is just TEXT)
