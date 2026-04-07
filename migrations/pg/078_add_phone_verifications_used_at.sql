-- Migration 078: add used_at to phone_verifications
-- Safe additive migration: no data rewrite, no deletion.

ALTER TABLE phone_verifications ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_phone_verifications_used_at
  ON phone_verifications (used_at);
