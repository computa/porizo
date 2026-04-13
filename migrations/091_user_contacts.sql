-- Migration 091: Create user_contacts (SQLite)
-- Part of the three-layer identity model (see docs/identity-contract.md)
-- Note: SQLite doesn't support partial unique indexes or CHECK on CREATE TABLE well.
--       Enforce uniqueness and constraints in application code.

CREATE TABLE IF NOT EXISTS user_contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value_normalized TEXT NOT NULL,
  value_display TEXT NOT NULL,
  verified_at TEXT,
  source TEXT NOT NULL,
  source_identity_id TEXT REFERENCES user_auth_providers(id) ON DELETE SET NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_relay INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_contacts_user ON user_contacts(user_id, type);
CREATE INDEX IF NOT EXISTS idx_user_contacts_lookup ON user_contacts(type, value_normalized);
