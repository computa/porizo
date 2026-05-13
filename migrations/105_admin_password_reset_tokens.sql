-- SQLite parallel of migrations/pg/105_admin_password_reset_tokens.sql.
-- See the PG file for the table contract and lifecycle notes.

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

CREATE INDEX IF NOT EXISTS idx_admin_pw_reset_tokens_admin_unused
  ON admin_password_reset_tokens(admin_id, used_at);
