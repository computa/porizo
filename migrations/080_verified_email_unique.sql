-- Migration 080: Partial UNIQUE index on verified emails
-- Prevents race condition where two concurrent registrations claim the same email.
-- Only applies to verified emails — unverified (self-asserted) emails can overlap.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email
  ON users(email)
  WHERE email_verified = 1 AND deleted_at IS NULL;
