ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS instrumental_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS guide_vocal_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS voice_conversion_url TEXT;
