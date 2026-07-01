-- Migration 122: SQLite parity marker.
--
-- SQLite already received the historical local migrations that prompted the
-- Root 9 drift review. This current-numbered file keeps migration filenames
-- aligned with the PostgreSQL parity backfill without changing local schema.

SELECT 1;
