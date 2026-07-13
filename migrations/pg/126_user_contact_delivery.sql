-- Migration 126: Separate email verification from contact deliverability (PostgreSQL)

ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS last_delivery_event_at TIMESTAMPTZ;
ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;
ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ;
ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ;
ALTER TABLE user_contacts ADD COLUMN IF NOT EXISTS suppression_reason TEXT;

DO $$ BEGIN
  ALTER TABLE user_contacts ADD CONSTRAINT user_contacts_delivery_status_check
    CHECK (delivery_status IN ('unknown', 'deliverable', 'bounced', 'complained', 'suppressed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_contacts_email_delivery
  ON user_contacts(type, value_normalized, delivery_status);

CREATE TABLE IF NOT EXISTS user_contact_delivery_events (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES user_contacts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (
    delivery_status IN ('deliverable', 'bounced', 'complained', 'suppressed')
  ),
  event_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (contact_id, provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_events_contact
  ON user_contact_delivery_events(contact_id, event_at);
