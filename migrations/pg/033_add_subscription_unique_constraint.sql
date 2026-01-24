-- Migration 033: Add unique constraint on original_transaction_id per platform
-- Prevents the same App Store/Play Store subscription from creating multiple records
-- (which could cause double-crediting)

-- SQLite doesn't support ADD CONSTRAINT, so we use CREATE UNIQUE INDEX
-- This enforces uniqueness for non-null original_transaction_id values
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_platform_original_tx
  ON subscriptions(platform, original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

-- Also add an index for efficient lookup by original_transaction_id (used in webhook handlers)
CREATE INDEX IF NOT EXISTS idx_subscriptions_original_tx
  ON subscriptions(original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;
