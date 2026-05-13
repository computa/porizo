-- Admin password reset tokens
-- Mirrors the user-side password_reset_tokens table but scoped to admin_users.
-- Used by /admin/auth/forgot-password and /admin/auth/reset-password.
--
-- Lifecycle:
--   1. Admin requests reset -> row inserted with token_hash, expires_at (30 min)
--   2. Admin opens email link -> /admin/auth/reset-password verifies token_hash
--      matches a row where used_at IS NULL and expires_at > now()
--   3. On successful reset -> used_at set, and all other unused tokens for the
--      same admin_id are also marked used (single-use across the set)
--   4. ON DELETE CASCADE: removing an admin_users row purges their tokens

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_pw_reset_tokens_hash
  ON admin_password_reset_tokens(token_hash);

-- Composite supports the "find unused tokens for this admin" path used by
-- invalidateAllPasswordResetTokens after a successful reset.
CREATE INDEX IF NOT EXISTS idx_admin_pw_reset_tokens_admin_unused
  ON admin_password_reset_tokens(admin_id, used_at);
