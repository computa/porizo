-- Retire `billing_holds` table and `track_versions.billing_hold_id` column
--
-- The billing_holds infrastructure was scaffolded for a planned reservation
-- model that never shipped. Production has 0 rows in billing_holds and no
-- code path inserts into it. The hold-expiry cleanup loop in server.js, the
-- releaseHoldIfNeeded helper in workflows/runner.js, and the cancel-render
-- refund block in routes/tracks.js have all been removed in the same change
-- set since they could never fire in production.
--
-- Use IF EXISTS for idempotency. CASCADE on the table drop covers any
-- foreign-key references that may exist in non-prod environments.

ALTER TABLE track_versions DROP COLUMN IF EXISTS billing_hold_id;
DROP TABLE IF EXISTS billing_holds CASCADE;
