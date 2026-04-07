-- Migration 079: Unified Phone Auth Provider
-- Makes phone a first-class provider in user_auth_providers.
-- Moves registration tokens from in-memory to DB.
-- Adds profile completion skip tracking.

-- ============ 1. EXPAND PROVIDER CHECK CONSTRAINT ============
-- Add 'phone' to the allowed provider values

ALTER TABLE user_auth_providers DROP CONSTRAINT IF EXISTS user_auth_providers_provider_check;
ALTER TABLE user_auth_providers ADD CONSTRAINT user_auth_providers_provider_check
  CHECK (provider IN ('apple', 'google', 'email', 'phone'));

-- ============ 2. BACKFILL EXISTING PHONE USERS ============
-- Any user with a verified phone_number gets a phone provider entry

INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id)
SELECT
  'ap_' || substr(md5(random()::text || u.id), 1, 16),
  u.id,
  'phone',
  u.phone_number
FROM users u
WHERE u.phone_number IS NOT NULL
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_auth_providers uap
    WHERE uap.user_id = u.id AND uap.provider = 'phone'
  );

-- ============ 3. REGISTRATION TOKENS TABLE ============
-- Replaces in-memory Map for multi-instance safety

CREATE TABLE IF NOT EXISTS phone_registration_tokens (
  token_hash TEXT PRIMARY KEY,
  phone_number_hash TEXT NOT NULL,
  ip_address TEXT,
  verified_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_phone_reg_tokens_expires
  ON phone_registration_tokens (expires_at);

-- ============ 4. BACKFILL verified_at FROM used_at ============
-- sms-service.js renamed used_at → verified_at. Copy old values to prevent stale code reuse.
UPDATE phone_verifications SET verified_at = COALESCE(verified_at, used_at)
  WHERE used_at IS NOT NULL AND verified_at IS NULL;

-- ============ 5. PROFILE COMPLETION SKIP TRACKING ============

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completion_skipped_at TIMESTAMPTZ;
