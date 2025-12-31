-- Add unique constraint to prevent version number race condition duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_versions_track_version ON track_versions (track_id, version_num);
