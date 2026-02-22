-- Add og_variant column for user-selectable OG image variants
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS og_variant TEXT;
ALTER TABLE poems ADD COLUMN IF NOT EXISTS og_variant TEXT;
