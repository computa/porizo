ALTER TABLE track_versions ADD COLUMN lyrics_status TEXT;
ALTER TABLE track_versions ADD COLUMN lyrics_updated_at TEXT;
ALTER TABLE track_versions ADD COLUMN lyrics_approved_at TEXT;

ALTER TABLE tracks ADD COLUMN deleted_at TEXT;
ALTER TABLE tracks ADD COLUMN deleted_reason TEXT;
