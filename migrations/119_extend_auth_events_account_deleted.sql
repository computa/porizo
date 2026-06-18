-- Migration: Extend auth_events event_type CHECK constraint (SQLite)
--
-- NOTE: SQLite DOES enforce CHECK constraints, contrary to the no-op assumption in
-- the sqlite 034 migration. As a result, 'signup_success', 'orphaned_provider_recovery'
-- and 'account_deleted' were never actually allowed in the SQLite (test) schema.
-- SQLite cannot ALTER a CHECK constraint, so we rebuild the table with the full
-- event-type set (matching migrations/pg/034 + pg/119) and copy existing rows.

CREATE TABLE auth_events_new (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'login_success', 'login_failed', 'logout',
    'signup_success', 'orphaned_provider_recovery',
    'token_refresh', 'token_revoked', 'token_reuse_detected',
    'password_changed', 'password_reset_requested', 'password_reset_completed',
    'provider_linked', 'provider_unlinked',
    'email_verified', 'account_locked', 'account_unlocked',
    'account_deleted'
  )),
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO auth_events_new (id, user_id, event_type, ip_address, user_agent, metadata, created_at)
  SELECT id, user_id, event_type, ip_address, user_agent, metadata, created_at FROM auth_events;

DROP TABLE auth_events;

ALTER TABLE auth_events_new RENAME TO auth_events;

CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_events_type ON auth_events(event_type, created_at);
