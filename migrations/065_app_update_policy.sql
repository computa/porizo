-- Migration 065: App update policy fields on security config

ALTER TABLE security_config ADD COLUMN ios_min_supported_version TEXT;
ALTER TABLE security_config ADD COLUMN ios_recommended_version TEXT;
ALTER TABLE security_config ADD COLUMN ios_update_message TEXT;
