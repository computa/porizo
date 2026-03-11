-- Migration 065: App update policy fields on security config

ALTER TABLE security_config
  ADD COLUMN IF NOT EXISTS ios_min_supported_version TEXT,
  ADD COLUMN IF NOT EXISTS ios_recommended_version TEXT,
  ADD COLUMN IF NOT EXISTS ios_update_message TEXT;
