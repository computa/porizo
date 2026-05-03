CREATE TABLE IF NOT EXISTS push_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    segment TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data_json TEXT,
    image_url TEXT,
    onesignal_notification_id TEXT,
    sent_at TEXT NOT NULL DEFAULT now(),
    recipients_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_campaigns_sent_at ON push_campaigns(sent_at);
