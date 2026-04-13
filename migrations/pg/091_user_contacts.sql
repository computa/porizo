-- Migration 091: Create user_contacts — sole contact authority
-- Part of the three-layer identity model (see docs/identity-contract.md)
-- Contact lifecycle: create unverified -> verify -> promote primary -> mirror to users

CREATE TABLE IF NOT EXISTS user_contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email', 'phone')),
  value_normalized TEXT NOT NULL,
  value_display TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('user_entered', 'apple_claim', 'phone_otp', 'admin', 'provider_sync')),
  source_identity_id TEXT REFERENCES user_auth_providers(id) ON DELETE SET NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_relay BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verified contact uniqueness: no two users can have the same verified email or phone
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_contacts_verified_unique
  ON user_contacts(type, value_normalized)
  WHERE verified_at IS NOT NULL;

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS idx_user_contacts_user
  ON user_contacts(user_id, type);

-- Reverse lookup: find user by contact value
CREATE INDEX IF NOT EXISTS idx_user_contacts_lookup
  ON user_contacts(type, value_normalized);

-- Ensure at most one primary per type per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_contacts_primary
  ON user_contacts(user_id, type)
  WHERE is_primary = true;
