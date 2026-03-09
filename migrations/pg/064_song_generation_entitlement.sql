-- Track-level preview/full render should share a single song-generation entitlement per version.
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS song_entitlement_consumed_at TEXT DEFAULT NULL;
