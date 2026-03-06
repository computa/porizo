-- Admin complimentary upgrade overlay columns
-- Enables time-limited tier overrides without touching subscription lifecycle
ALTER TABLE entitlements ADD COLUMN admin_upgrade_tier TEXT DEFAULT NULL;
ALTER TABLE entitlements ADD COLUMN admin_upgrade_expires_at TEXT DEFAULT NULL;
