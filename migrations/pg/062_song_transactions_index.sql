-- Add composite index for revocation grant-total query (H5).
-- The handleRevocation query filters on (user_id, reference_id, type)
-- but only single-column indexes existed previously.
CREATE INDEX IF NOT EXISTS idx_song_transactions_user_ref
  ON song_transactions(user_id, reference_id);
