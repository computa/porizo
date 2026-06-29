-- Migration 123: PostgreSQL parity marker.
--
-- PostgreSQL already dropped these artifacts in migrations 094 and 095:
-- entitlements.credits_balance, entitlements.credits_used_total,
-- track_versions.billing_hold_id, and billing_holds.

SELECT 1;
