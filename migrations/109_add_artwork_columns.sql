-- Migration 109: Per-song occasion artwork (SQLite mirror for test suite)
-- SQLite ALTER lacks IF NOT EXISTS for columns; the migration runner handles idempotency.

ALTER TABLE tracks ADD COLUMN artwork_url TEXT;
ALTER TABLE tracks ADD COLUMN artwork_style_variant TEXT;
ALTER TABLE tracks ADD COLUMN artwork_source TEXT;
ALTER TABLE tracks ADD COLUMN artwork_provider TEXT;
ALTER TABLE tracks ADD COLUMN artwork_prompt TEXT;
ALTER TABLE tracks ADD COLUMN artwork_content_hash TEXT;
ALTER TABLE tracks ADD COLUMN artwork_moderation_passed INTEGER;
ALTER TABLE tracks ADD COLUMN artwork_generated_at TEXT;

ALTER TABLE track_versions ADD COLUMN audio_ready INTEGER DEFAULT 0;
ALTER TABLE track_versions ADD COLUMN artwork_ready INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tracks_artwork_style_variant ON tracks (artwork_style_variant);
CREATE INDEX IF NOT EXISTS idx_tracks_artwork_content_hash ON tracks (artwork_content_hash);
