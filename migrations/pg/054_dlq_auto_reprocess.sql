-- Track auto-reprocessing attempts for dead-letter queue entries
-- Enables background DLQ reprocessor to limit retries (max 2)

ALTER TABLE dead_letter_queue
ADD COLUMN IF NOT EXISTS auto_reprocess_count INTEGER NOT NULL DEFAULT 0;
