-- Add auto-sync metadata for iOS update policy sourced from App Store Connect
ALTER TABLE security_config ADD COLUMN ios_auto_recommended_version INTEGER DEFAULT 0;
ALTER TABLE security_config ADD COLUMN ios_last_app_store_version TEXT;
ALTER TABLE security_config ADD COLUMN ios_last_app_store_sync_at TEXT;
ALTER TABLE security_config ADD COLUMN ios_app_store_sync_error TEXT;
