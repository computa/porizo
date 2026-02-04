-- Migration 041: Add push token support for APNs notifications
-- Enables server-side push notifications when renders complete

ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ;

-- Index for looking up devices by push token (e.g., finding stale tokens)
CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token) WHERE push_token IS NOT NULL;

COMMENT ON COLUMN devices.push_token IS 'APNs device token for push notifications';
COMMENT ON COLUMN devices.push_token_updated_at IS 'When the push token was last updated';
