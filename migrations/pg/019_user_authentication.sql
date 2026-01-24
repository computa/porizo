-- Migration 019: User Authentication System
-- Adds tables for social login (Apple/Google), email auth, sessions, and audit

-- Add auth-related columns to users table
-- Note: SQLite doesn't support ADD COLUMN with UNIQUE, so we add index separately
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN failed_login_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- Create unique index on email (workaround for SQLite UNIQUE constraint limitation)
CREATE UNIQUE INDEX idx_users_email_unique ON users(email) WHERE email IS NOT NULL;

-- Auth providers (apple, google, email)
CREATE TABLE user_auth_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('apple', 'google', 'email')),
  provider_user_id TEXT NOT NULL,
  provider_data TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE(provider, provider_user_id)
);

-- Password credentials (email provider only)
CREATE TABLE user_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_changed_at TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- User sessions (device management)
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  last_active_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Token families (for rotation tracking and bulk revocation)
CREATE TABLE token_families (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES user_sessions(id) ON DELETE CASCADE,
  compromised_at TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Refresh tokens (rotatable, revocable)
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_family TEXT NOT NULL REFERENCES token_families(id) ON DELETE CASCADE,
  generation INTEGER DEFAULT 1,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  requested_ip TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Email verification tokens
CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Auth events (audit trail)
CREATE TABLE auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'login_success', 'login_failed', 'logout',
    'token_refresh', 'token_revoked', 'token_reuse_detected',
    'password_changed', 'password_reset_requested', 'password_reset_completed',
    'provider_linked', 'provider_unlinked',
    'email_verified', 'account_locked', 'account_unlocked'
  )),
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- ============ INDEXES ============

-- Users (email unique index already created above)

-- Auth providers
CREATE INDEX idx_auth_providers_user ON user_auth_providers(user_id);
CREATE INDEX idx_auth_providers_lookup ON user_auth_providers(provider, provider_user_id);

-- Sessions
CREATE INDEX idx_sessions_user_active ON user_sessions(user_id, last_active_at);

-- Token families
CREATE INDEX idx_token_families_user ON token_families(user_id);

-- Refresh tokens (critical for performance)
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(token_family);

-- Password reset tokens
CREATE INDEX idx_password_reset_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);

-- Email verification tokens
CREATE INDEX idx_email_verify_hash ON email_verification_tokens(token_hash);
CREATE INDEX idx_email_verify_user ON email_verification_tokens(user_id);

-- Auth events
CREATE INDEX idx_auth_events_user ON auth_events(user_id, created_at);
CREATE INDEX idx_auth_events_type ON auth_events(event_type, created_at);
