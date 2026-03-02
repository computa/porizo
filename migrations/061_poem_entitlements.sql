-- Migration: Add poem entitlement tracking columns + admin-configurable free tier grants
--
-- Adds poems_remaining, poems_allowance, poems_used_total to entitlements table.
-- Adds feature flags for admin-configurable free tier song/poem grants.
-- Backfills existing free users who haven't used their allowance.

-- 1. Add poem tracking columns to entitlements
ALTER TABLE entitlements ADD COLUMN poems_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN poems_allowance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN poems_used_total INTEGER NOT NULL DEFAULT 0;

-- 2. Add feature flags for admin-configurable free tier grants
INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('free_tier_songs_grant', '1', CURRENT_TIMESTAMP, 'migration_061')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('free_tier_poems_grant', '1', CURRENT_TIMESTAMP, 'migration_061')
ON CONFLICT (id) DO NOTHING;

-- 3. Backfill existing free users: grant 1 poem to those who haven't created one yet
UPDATE entitlements SET poems_remaining = 1
WHERE tier = 'free' AND poems_used_total = 0;

-- 4. Fix songs_remaining for existing free users who haven't used their song
UPDATE entitlements SET songs_remaining = 1
WHERE tier = 'free' AND songs_used_total = 0 AND songs_remaining = 0;
