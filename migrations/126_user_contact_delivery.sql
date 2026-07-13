-- Migration 126: Separate email verification from contact deliverability (SQLite)

ALTER TABLE user_contacts ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE user_contacts ADD COLUMN last_delivery_event_at TEXT;
ALTER TABLE user_contacts ADD COLUMN delivered_at TEXT;
ALTER TABLE user_contacts ADD COLUMN bounced_at TEXT;
ALTER TABLE user_contacts ADD COLUMN complained_at TEXT;
ALTER TABLE user_contacts ADD COLUMN suppressed_at TEXT;
ALTER TABLE user_contacts ADD COLUMN suppression_reason TEXT;

CREATE TRIGGER IF NOT EXISTS trg_user_contacts_delivery_status_insert
BEFORE INSERT ON user_contacts
WHEN NEW.delivery_status NOT IN ('unknown', 'deliverable', 'bounced', 'complained', 'suppressed')
BEGIN
  SELECT RAISE(ABORT, 'invalid user_contacts delivery_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_user_contacts_delivery_status_update
BEFORE UPDATE OF delivery_status ON user_contacts
WHEN NEW.delivery_status NOT IN ('unknown', 'deliverable', 'bounced', 'complained', 'suppressed')
BEGIN
  SELECT RAISE(ABORT, 'invalid user_contacts delivery_status');
END;

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
  event_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (contact_id, provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_events_contact
  ON user_contact_delivery_events(contact_id, event_at);
