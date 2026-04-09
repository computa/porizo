-- Add voice_gender column to tracks table
-- Allows users to choose male/female vocal for Suno generation
-- NULL = no preference (Suno picks randomly, backward compatible)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS voice_gender TEXT
  CHECK (voice_gender IN ('male', 'female'));
