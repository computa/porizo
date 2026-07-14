ALTER TABLE magic_login_transactions
  ADD COLUMN IF NOT EXISTS authorizing_session_id TEXT
  REFERENCES user_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_magic_login_authorizing_session
  ON magic_login_transactions (authorizing_session_id, status)
  WHERE authorizing_session_id IS NOT NULL;
