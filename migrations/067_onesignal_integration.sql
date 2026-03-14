-- OneSignal integration tracking
-- Stores OneSignal external ID mapping and tag sync metadata

ALTER TABLE users ADD COLUMN IF NOT EXISTS onesignal_synced_at TIMESTAMPTZ;

-- Track campaign sends for analytics (optional, lightweight)
CREATE TABLE IF NOT EXISTS push_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    segment TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data_json TEXT,
    image_url TEXT,
    onesignal_notification_id TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recipients_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_campaigns_sent_at ON push_campaigns(sent_at);
