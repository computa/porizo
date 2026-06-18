-- Migration: granted_identities tombstone table (Sybil free-credit floor)
-- Survives account deletion so a previously-granted identity cannot re-farm free credits.
-- identity_hash is a salted one-way SHA-256 of provider plus subject plus salt.
-- The raw subject is never stored.

CREATE TABLE IF NOT EXISTS granted_identities (
  identity_hash TEXT PRIMARY KEY,
  grant_kind TEXT NOT NULL,
  first_granted_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);
