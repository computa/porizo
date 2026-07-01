-- Migration: allow distinct signup and trial tombstones per identity.

ALTER TABLE granted_identities
  DROP CONSTRAINT IF EXISTS granted_identities_pkey;

ALTER TABLE granted_identities
  ALTER COLUMN identity_hash SET NOT NULL,
  ALTER COLUMN grant_kind SET NOT NULL;

ALTER TABLE granted_identities
  ADD PRIMARY KEY (identity_hash, grant_kind);
