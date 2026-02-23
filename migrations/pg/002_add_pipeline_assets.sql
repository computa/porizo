ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_json TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS music_plan_json TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS moderation_status TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
