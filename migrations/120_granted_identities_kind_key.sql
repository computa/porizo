-- Migration: allow distinct signup and trial tombstones per identity.
-- Migration 118 keyed only identity_hash, but callers record grant_kind too.
-- Account deletion may need to preserve both "signup" and "trial" tombstones
-- for the same identity after the user row and entitlement state are erased.

CREATE TABLE IF NOT EXISTS granted_identities_new (
  identity_hash TEXT NOT NULL,
  grant_kind TEXT NOT NULL,
  first_granted_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (identity_hash, grant_kind)
);

INSERT OR IGNORE INTO granted_identities_new (
  identity_hash, grant_kind, first_granted_at
)
SELECT identity_hash, grant_kind, first_granted_at
FROM granted_identities;

DROP TABLE granted_identities;
ALTER TABLE granted_identities_new RENAME TO granted_identities;
