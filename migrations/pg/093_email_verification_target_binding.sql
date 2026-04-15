-- Migration 093: Bind email verification tokens to the email they were issued for
-- Prevents a token issued for email A from verifying a later email B on the same account.

ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS email_normalized TEXT;

CREATE INDEX IF NOT EXISTS idx_email_verify_user_email
  ON email_verification_tokens(user_id, email_normalized);
