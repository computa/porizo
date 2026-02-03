-- Migration 042: Add cover image URL columns to track_versions
-- Stores URLs for cover art at multiple resolutions

ALTER TABLE track_versions ADD COLUMN cover_image_url TEXT;
ALTER TABLE track_versions ADD COLUMN cover_image_small_url TEXT;
ALTER TABLE track_versions ADD COLUMN cover_image_large_url TEXT;
