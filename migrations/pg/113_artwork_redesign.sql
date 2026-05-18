-- Migration 113: Lyrics-aware bounded-vocab artwork (PostgreSQL)
-- Adds per-version artwork vars, provider attribution, and prompt template version.

ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_vars_json JSONB;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_provider TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_prompt_version TEXT;
