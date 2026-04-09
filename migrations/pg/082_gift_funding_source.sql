-- Migration 082: mark gift-funded content so gift flows do not consume subscription credits

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS gift_reservation_id TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE poems ADD COLUMN IF NOT EXISTS gift_reservation_id TEXT;
ALTER TABLE poems ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_funding_source_check;
ALTER TABLE tracks
  ADD CONSTRAINT tracks_funding_source_check
  CHECK (funding_source IN ('standard', 'gift_token'));

ALTER TABLE poems DROP CONSTRAINT IF EXISTS poems_funding_source_check;
ALTER TABLE poems
  ADD CONSTRAINT poems_funding_source_check
  CHECK (funding_source IN ('standard', 'gift_token'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_gift_reservation_active
  ON tracks(gift_reservation_id)
  WHERE gift_reservation_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_poems_gift_reservation_active
  ON poems(gift_reservation_id)
  WHERE gift_reservation_id IS NOT NULL AND deleted_at IS NULL;
