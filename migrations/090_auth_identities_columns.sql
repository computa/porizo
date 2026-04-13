-- Migration 090: Evolve user_auth_providers (SQLite)
-- Adds verified_at, linked_at, last_used_at, status columns
-- Part of the three-layer identity model (see docs/identity-contract.md)
-- Note: SQLite doesn't support CHECK constraints on ALTER or partial indexes.
--       Enforce in application code.

ALTER TABLE user_auth_providers ADD COLUMN verified_at TEXT;
ALTER TABLE user_auth_providers ADD COLUMN linked_at TEXT;
ALTER TABLE user_auth_providers ADD COLUMN last_used_at TEXT;
ALTER TABLE user_auth_providers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_auth_providers_login
  ON user_auth_providers(provider, provider_user_id);

CREATE INDEX IF NOT EXISTS idx_auth_providers_last_used
  ON user_auth_providers(user_id, last_used_at);
