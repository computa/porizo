-- Migration 042: Add cover image URL columns to track_versions
-- Mirrors SQLite migration 042_add_cover_image_urls.sql

ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS cover_image_small_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS cover_image_large_url TEXT;
