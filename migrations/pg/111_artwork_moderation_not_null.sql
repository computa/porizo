-- Migration 111: enforce NOT NULL DEFAULT FALSE on artwork_moderation_passed
--
-- See migrations/111_artwork_moderation_not_null.sql for the rationale.

UPDATE tracks SET artwork_moderation_passed = FALSE WHERE artwork_moderation_passed IS NULL;
ALTER TABLE tracks ALTER COLUMN artwork_moderation_passed SET DEFAULT FALSE;
ALTER TABLE tracks ALTER COLUMN artwork_moderation_passed SET NOT NULL;
