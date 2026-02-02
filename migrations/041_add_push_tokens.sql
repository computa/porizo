-- Migration 041: Add push token support for APNs notifications
-- Enables server-side push notifications when renders complete

ALTER TABLE devices ADD COLUMN push_token TEXT;
ALTER TABLE devices ADD COLUMN push_token_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token) WHERE push_token IS NOT NULL;
