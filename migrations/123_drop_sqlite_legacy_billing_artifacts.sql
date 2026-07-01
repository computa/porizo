-- Migration 123: Drop local/test copies of retired billing artifacts.
--
-- PostgreSQL retired these in migrations 094 and 095. SQLite kept them only
-- because old tests still inserted fixture rows. Runtime code no longer reads
-- these fields or table.

ALTER TABLE entitlements DROP COLUMN credits_balance;
ALTER TABLE entitlements DROP COLUMN credits_used_total;
ALTER TABLE track_versions DROP COLUMN billing_hold_id;
DROP TABLE IF EXISTS billing_holds;
