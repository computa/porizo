-- Migration 090: Evolve user_auth_providers into authoritative identity table
-- Adds verified_at, linked_at, last_used_at, status columns
-- Part of the three-layer identity model (see docs/identity-contract.md)

ALTER TABLE user_auth_providers
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Note: status CHECK constraint enforced by identity-service.js validation.
-- PG DO blocks use $$ which conflicts with the migration runner's statement splitter.

-- Index for sign-in resolution: provider + subject WHERE active
CREATE INDEX IF NOT EXISTS idx_auth_providers_login
  ON user_auth_providers(provider, provider_user_id)
  WHERE status = 'active';

-- Index for last_used_at telemetry queries
CREATE INDEX IF NOT EXISTS idx_auth_providers_last_used
  ON user_auth_providers(user_id, last_used_at DESC);
