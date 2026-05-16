-- Migration 111: enforce NOT NULL DEFAULT 0 on artwork_moderation_passed
--
-- Migration 109 added the column as nullable, which created a tri-state
-- (NULL = unset, 0 = blocked/unverified, 1 = passed) the audit story can't
-- defend cleanly: a NULL post-crash is indistinguishable from "check skipped".
-- This migration consolidates to a strict boolean — NULL backfills to 0
-- (conservative: not verified) and the column becomes NOT NULL going forward.

-- Backfill any nulls to 0 (conservative — caller must explicitly set 1).
UPDATE tracks SET artwork_moderation_passed = 0 WHERE artwork_moderation_passed IS NULL;

-- SQLite 3.35+ can change a column's NOT NULL constraint via ALTER … RENAME,
-- but the simpler portable approach for sql.js is to leave the column nullable
-- in SQLite and rely on application logic + the backfill above. PG enforces
-- the constraint properly (see migrations/pg/111_…).
