-- Migration 113: Lyrics-aware bounded-vocab artwork (SQLite mirror for test suite)
-- SQLite ALTER lacks IF NOT EXISTS for columns; the migration runner handles idempotency.

ALTER TABLE track_versions ADD COLUMN artwork_vars_json TEXT;
ALTER TABLE track_versions ADD COLUMN artwork_provider TEXT;
ALTER TABLE track_versions ADD COLUMN artwork_prompt_version TEXT;
