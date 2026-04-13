-- Migration 092: enforce valid auth provider status values in PostgreSQL
-- Part of the authoritative identity model hard cutover.

-- Normalize any drifted rows before adding the constraint.
UPDATE user_auth_providers
SET status = 'active'
WHERE status IS NULL OR status NOT IN ('active', 'revoked', 'suspended');

-- Idempotent: drop-then-add avoids "already exists" on re-run.
ALTER TABLE user_auth_providers
  DROP CONSTRAINT IF EXISTS user_auth_providers_status_check;

ALTER TABLE user_auth_providers
  ADD CONSTRAINT user_auth_providers_status_check
  CHECK (status IN ('active', 'revoked', 'suspended'));
