-- Migration 110: drop track_versions.audio_ready
--
-- The audio_ready flag was added by migration 109 to coordinate the artwork
-- barrier, but in practice it's write-only — the barrier polls artwork_ready
-- only, and status transitions already encode "audio done." Remove the dead
-- column.
--
-- SQLite 3.35+ supports DROP COLUMN directly. The project uses sql.js for
-- tests which targets 3.45+, so this is safe.

ALTER TABLE track_versions DROP COLUMN audio_ready;
