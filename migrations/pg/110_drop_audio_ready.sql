-- Migration 110: drop track_versions.audio_ready
--
-- The audio_ready flag was added by migration 109 to coordinate the artwork
-- barrier, but in practice it's write-only — the barrier polls artwork_ready
-- only, and status transitions already encode "audio done." Remove the dead
-- column.

ALTER TABLE track_versions DROP COLUMN IF EXISTS audio_ready;
