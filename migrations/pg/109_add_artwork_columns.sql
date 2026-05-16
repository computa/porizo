-- Migration 109: Per-song occasion artwork (PostgreSQL)
-- Adds track-level artwork columns + per-version coordination flags for parallel render barrier.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_style_variant TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_source TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_provider TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_prompt TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_content_hash TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_moderation_passed BOOLEAN;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_generated_at TIMESTAMPTZ;

ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS audio_ready BOOLEAN DEFAULT FALSE;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_ready BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tracks_artwork_style_variant ON tracks (artwork_style_variant) WHERE artwork_style_variant IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_artwork_content_hash ON tracks (artwork_content_hash) WHERE artwork_content_hash IS NOT NULL;
