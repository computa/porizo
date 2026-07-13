ALTER TABLE magic_login_transactions
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_magic_login_approval
  ON magic_login_transactions (status, approved_at, expires_at);
