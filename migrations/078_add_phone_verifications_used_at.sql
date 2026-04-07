-- Migration 078: add used_at to phone_verifications
-- Safe additive migration: no data rewrite, no deletion.

ALTER TABLE phone_verifications ADD COLUMN used_at TEXT;

CREATE INDEX IF NOT EXISTS idx_phone_verifications_used_at
  ON phone_verifications (used_at);
