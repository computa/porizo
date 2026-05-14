-- 107_cold_email_updated_at.sql (Postgres)
-- Adds updated_at to cold_email_campaigns for optimistic concurrency on
-- the admin PATCH endpoint.

ALTER TABLE cold_email_campaigns ADD COLUMN IF NOT EXISTS updated_at TEXT;
UPDATE cold_email_campaigns SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP::text) WHERE updated_at IS NULL;
