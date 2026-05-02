-- Retire legacy credits ledger from `entitlements`
--
-- `credits_balance` and `credits_used_total` are remnants of the pre-2026
-- billing model. `songs_remaining` and `songs_used_total` are the canonical
-- ledger that gates renders, and the legacy columns have drifted across the
-- entire user base because the subscription-grant upsert never refilled
-- credits_balance while spendSong kept decrementing it. The columns are not
-- exposed via the public API and the iOS app does not read them.
--
-- All server reads/writes have been removed in the same change set.

ALTER TABLE entitlements DROP COLUMN IF EXISTS credits_balance;
ALTER TABLE entitlements DROP COLUMN IF EXISTS credits_used_total;
