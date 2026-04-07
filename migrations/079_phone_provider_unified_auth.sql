-- Migration 079: Unified Phone Auth Provider (SQLite)
-- Makes phone a first-class provider in user_auth_providers.
-- Moves registration tokens from in-memory to DB.
-- Adds profile completion skip tracking.

-- ============ 1. RECREATE user_auth_providers WITH PHONE PROVIDER ============
-- SQLite cannot ALTER CHECK constraints, so we recreate the table.

CREATE TABLE IF NOT EXISTS user_auth_providers_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('apple', 'google', 'email', 'phone')),
  provider_user_id TEXT NOT NULL,
  provider_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);

INSERT OR IGNORE INTO user_auth_providers_new
  SELECT id, user_id, provider, provider_user_id, provider_data, created_at
  FROM user_auth_providers;

DROP TABLE IF EXISTS user_auth_providers;
ALTER TABLE user_auth_providers_new RENAME TO user_auth_providers;

-- ============ 2. REGISTRATION TOKENS TABLE ============

CREATE TABLE IF NOT EXISTS phone_registration_tokens (
  token_hash TEXT PRIMARY KEY,
  phone_number_hash TEXT NOT NULL,
  ip_address TEXT,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

-- ============ 3. PROFILE COMPLETION SKIP TRACKING ============
-- Safe: ADD COLUMN IF NOT EXISTS not supported in older SQLite,
-- but sql.js supports it.

ALTER TABLE users ADD COLUMN profile_completion_skipped_at TEXT;
