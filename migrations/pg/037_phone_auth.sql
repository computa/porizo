-- Migration 037: Phone Authentication
-- Adds phone verification table and phone columns to users

-- ============ PHONE VERIFICATIONS TABLE ============
-- Tracks SMS verification codes for phone authentication

CREATE TABLE IF NOT EXISTS phone_verifications (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,  -- E.164 format: +1234567890
  code TEXT NOT NULL,          -- 6-digit code (plaintext for dev, use code_hash in prod)
  code_hash TEXT,              -- SHA-256 hash of code for secure storage
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,     -- NULL until verified
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ ADD PHONE AND USERNAME COLUMNS TO USERS ============

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

-- ============ INDEXES ============

-- Phone verifications: lookup by phone number and check expiration
CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone
  ON phone_verifications (phone_number);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_expires
  ON phone_verifications (expires_at);

-- Users: unique phone number (only where not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users (phone_number) WHERE phone_number IS NOT NULL;

-- Users: unique username (only where not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (username) WHERE username IS NOT NULL;
