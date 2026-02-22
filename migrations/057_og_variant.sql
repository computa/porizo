-- Add og_variant column for user-selectable OG image variants
ALTER TABLE tracks ADD COLUMN og_variant TEXT;
ALTER TABLE poems ADD COLUMN og_variant TEXT;
