-- Track-level preview/full render should share a single song-generation entitlement per version.
ALTER TABLE track_versions ADD COLUMN song_entitlement_consumed_at TEXT DEFAULT NULL;
