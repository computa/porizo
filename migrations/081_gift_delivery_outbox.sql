-- Migration 081: Add durable per-channel delivery outbox for gifts

CREATE TABLE IF NOT EXISTS gift_delivery_outbox (
  id TEXT PRIMARY KEY,
  gift_order_id TEXT NOT NULL,
  channel TEXT NOT NULL, -- sms | email
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed | cancelled
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error TEXT,
  send_after TEXT NOT NULL,
  next_retry_at TEXT,
  last_attempt_at TEXT,
  locked_at TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_delivery_outbox_gift_channel
  ON gift_delivery_outbox(gift_order_id, channel);

CREATE INDEX IF NOT EXISTS idx_gift_delivery_outbox_due
  ON gift_delivery_outbox(status, next_retry_at, send_after);

CREATE INDEX IF NOT EXISTS idx_gift_delivery_outbox_gift
  ON gift_delivery_outbox(gift_order_id, created_at DESC);
