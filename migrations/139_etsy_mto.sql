-- Etsy made-to-order production records. This is intentionally separate from
-- the retired redemption-code fulfilment aggregate in migration 137.

CREATE TABLE IF NOT EXISTS etsy_mto_orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  financial_state TEXT NOT NULL DEFAULT 'active'
    CHECK (financial_state IN ('active', 'canceled', 'refunded', 'partial_refund_attention')),
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'verified_paid', 'in_progress', 'completed', 'canceled', 'needs_attention')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS etsy_mto_items (
  id TEXT PRIMARY KEY,
  etsy_mto_order_id TEXT NOT NULL REFERENCES etsy_mto_orders(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  listing_id TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  raw_personalization_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'verified_paid', 'lyrics_review', 'rendering', 'ready_for_etsy_upload', 'etsy_completion_attested', 'canceled', 'needs_attention')),
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  track_version_id TEXT REFERENCES track_versions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (etsy_mto_order_id, transaction_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_etsy_mto_items_state
  ON etsy_mto_items(state, updated_at);

CREATE TABLE IF NOT EXISTS etsy_mto_events (
  id TEXT PRIMARY KEY,
  etsy_mto_item_id TEXT NOT NULL REFERENCES etsy_mto_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (etsy_mto_item_id, idempotency_key)
);

ALTER TABLE tracks ADD COLUMN etsy_mto_item_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_etsy_mto_item_id
  ON tracks(etsy_mto_item_id)
  WHERE etsy_mto_item_id IS NOT NULL;
