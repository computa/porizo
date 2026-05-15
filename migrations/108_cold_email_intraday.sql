-- 108_cold_email_intraday.sql
-- Multi-fire-per-day support for cold_email_campaigns.
--
-- Adds two knobs that together replace the previous "fire once per UTC day"
-- semantics enforced by `last_run_date_utc === today`:
--
--   min_minutes_between_runs  — minimum gap between successive fires.
--                               Default 1440 (24h) preserves the old
--                               single-fire-per-day behaviour for any
--                               existing or new campaign that doesn't
--                               opt into intraday cadence.
--   fire_until_utc_hour       — upper bound on the daily fire window.
--                               Default 24 means "no upper bound"
--                               (gate compares hour >= fire_until_utc_hour,
--                               and hour is always 0..23). Tighten to 19
--                               to stop fires at/after 19:00 UTC.
--
-- The gate in src/services/cold-email-service.js now reads:
--   active = 1
--   AND today >= earliest_run_date_utc
--   AND fire_after_utc_hour <= hour < fire_until_utc_hour
--   AND (last_run_at IS NULL OR last_run_at <= now - min_minutes_between_runs)
--   AND pending_count > 0
--
-- `last_run_date_utc` is still written by the service for the admin
-- "fired today?" display but no longer gates the claim.

ALTER TABLE cold_email_campaigns
  ADD COLUMN min_minutes_between_runs INTEGER NOT NULL DEFAULT 1440;

ALTER TABLE cold_email_campaigns
  ADD COLUMN fire_until_utc_hour INTEGER NOT NULL DEFAULT 24;
