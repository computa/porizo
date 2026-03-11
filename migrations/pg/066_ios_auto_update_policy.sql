-- Add auto-sync metadata for iOS update policy sourced from App Store Connect
ALTER TABLE security_config
  ADD COLUMN IF NOT EXISTS ios_auto_recommended_version INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ios_last_app_store_version TEXT,
  ADD COLUMN IF NOT EXISTS ios_last_app_store_sync_at TEXT,
  ADD COLUMN IF NOT EXISTS ios_app_store_sync_error TEXT;
