-- Migration 011: Add moderation details to track_versions
-- Implements Phase 3.1 moderation audit trail

-- Add moderation_details_json to track_versions for moderation audit
-- This stores the moderation check results for each version
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS moderation_details_json TEXT;

-- Add content_hash for deduplication
-- Allows detection of duplicate content across versions
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Index for content deduplication lookups
CREATE INDEX IF NOT EXISTS idx_track_versions_content_hash ON track_versions(track_id, content_hash);

-- Add share_events table if not exists (for enhanced share audit trail)
CREATE TABLE IF NOT EXISTS share_events (
    id SERIAL PRIMARY KEY,
    event_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details_json TEXT,
    created_at INTEGER NOT NULL
);

-- Index for event lookup and rate limiting
CREATE INDEX IF NOT EXISTS idx_share_events_key ON share_events(event_key, event_type, created_at);
