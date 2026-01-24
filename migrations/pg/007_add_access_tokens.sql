ALTER TABLE jobs ADD COLUMN error_code TEXT;
ALTER TABLE jobs ADD COLUMN error_message TEXT;
ALTER TABLE jobs ADD COLUMN next_attempt_at TEXT;

ALTER TABLE enrollment_sessions ADD COLUMN access_token TEXT;
ALTER TABLE track_versions ADD COLUMN guide_access_token TEXT;
