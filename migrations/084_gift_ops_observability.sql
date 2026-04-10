-- Migration 084: Add observability, receipt state, and incident tracking for gift delivery

ALTER TABLE gift_orders ADD COLUMN first_dispatch_started_at TEXT;
ALTER TABLE gift_orders ADD COLUMN last_dispatch_completed_at TEXT;
ALTER TABLE gift_orders ADD COLUMN last_successful_delivery_at TEXT;
ALTER TABLE gift_orders ADD COLUMN delivery_lag_ms INTEGER;
ALTER TABLE gift_orders ADD COLUMN overdue_detected_at TEXT;

ALTER TABLE gift_delivery_outbox ADD COLUMN provider_name TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN first_queued_at TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN first_attempt_started_at TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN provider_accepted_at TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN receipt_status TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN receipt_event_at TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN receipt_updated_at TEXT;
ALTER TABLE gift_delivery_outbox ADD COLUMN receipt_payload_json TEXT;

UPDATE gift_delivery_outbox
SET provider_name = CASE channel
  WHEN 'sms' THEN 'twilio'
  WHEN 'email' THEN 'resend'
  ELSE 'unknown'
END
WHERE provider_name IS NULL;

UPDATE gift_delivery_outbox
SET first_queued_at = COALESCE(first_queued_at, created_at, send_after)
WHERE first_queued_at IS NULL;

CREATE TABLE IF NOT EXISTS gift_delivery_incidents (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  gift_order_id TEXT,
  outbox_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  summary TEXT NOT NULL,
  detail TEXT,
  metadata_json TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gift_delivery_incidents_status
  ON gift_delivery_incidents(status, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gift_delivery_incidents_gift
  ON gift_delivery_incidents(gift_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gift_delivery_incidents_type
  ON gift_delivery_incidents(incident_type, status, created_at DESC);
