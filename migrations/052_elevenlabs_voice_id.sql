-- Add ElevenLabs voice clone ID to voice_profiles
-- This stores the voice_id returned when creating an Instant Voice Clone
ALTER TABLE voice_profiles ADD COLUMN elevenlabs_voice_id TEXT;
