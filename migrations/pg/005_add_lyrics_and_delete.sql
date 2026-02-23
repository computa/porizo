ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_status TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_updated_at TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_approved_at TEXT;

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
