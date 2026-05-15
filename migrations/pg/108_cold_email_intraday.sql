-- 108_cold_email_intraday.sql (Postgres)
-- Multi-fire-per-day support for cold_email_campaigns.
-- See migrations/108_cold_email_intraday.sql for design notes.

ALTER TABLE cold_email_campaigns
  ADD COLUMN IF NOT EXISTS min_minutes_between_runs INTEGER NOT NULL DEFAULT 1440;

ALTER TABLE cold_email_campaigns
  ADD COLUMN IF NOT EXISTS fire_until_utc_hour INTEGER NOT NULL DEFAULT 24;
