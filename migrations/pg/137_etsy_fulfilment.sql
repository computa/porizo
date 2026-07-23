-- Durable, order-backed Etsy fulfilment. PostgreSQL production twin.

ALTER TABLE etsy_redemption_codes ADD COLUMN IF NOT EXISTS etsy_order_unit_id TEXT;
ALTER TABLE etsy_redemption_codes ADD COLUMN IF NOT EXISTS grant_transaction_id TEXT;

CREATE TABLE IF NOT EXISTS etsy_connections (
  shop_id TEXT PRIMARY KEY,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  access_expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  scopes TEXT NOT NULL DEFAULT 'transactions_r',
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'reconnect_required')),
  reconciliation_cursor TIMESTAMPTZ,
  reconciliation_lease_until TIMESTAMPTZ,
  refresh_lease_until TIMESTAMPTZ,
  token_version INTEGER NOT NULL DEFAULT 0,
  bootstrap_token_fingerprint TEXT,
  bootstrap_generation INTEGER,
  last_reconciled_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS etsy_webhook_events (
  webhook_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  shop_id TEXT,
  receipt_id TEXT,
  body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS etsy_orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  buyer_user_id TEXT,
  buyer_email_encrypted TEXT,
  buyer_email_lookup_hash TEXT,
  currency TEXT,
  amount_minor INTEGER,
  provider_status TEXT,
  provider_updated_at TIMESTAMPTZ,
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0,
  manual_review_reason TEXT,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  is_canceled BOOLEAN NOT NULL DEFAULT FALSE,
  state TEXT NOT NULL DEFAULT 'paid'
    CHECK (state IN ('paid', 'claim_pending', 'claimed', 'fulfilled', 'canceled', 'refunded', 'manual_review')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (shop_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS etsy_order_units (
  id TEXT PRIMARY KEY,
  etsy_order_id TEXT NOT NULL REFERENCES etsy_orders(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'paid'
    CHECK (state IN ('paid', 'claim_pending', 'claimed', 'reserved', 'rendering', 'delivered', 'canceled', 'refunded', 'manual_review')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  grant_transaction_id TEXT,
  gift_reservation_id TEXT,
  web_order_id TEXT,
  gift_order_id TEXT,
  track_id TEXT,
  track_version_id TEXT,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (etsy_order_id, transaction_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_etsy_order_units_owner_state
  ON etsy_order_units(owner_user_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_etsy_order_units_gift_reservation
  ON etsy_order_units(gift_reservation_id)
  WHERE gift_reservation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_etsy_order_units_web_order
  ON etsy_order_units(web_order_id)
  WHERE web_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS etsy_claim_tokens (
  id TEXT PRIMARY KEY,
  etsy_order_id TEXT NOT NULL REFERENCES etsy_orders(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL UNIQUE,
  secret_last4 TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (etsy_order_id, generation)
);

CREATE TABLE IF NOT EXISTS etsy_payment_adjustments (
  adjustment_item_id TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL,
  etsy_order_id TEXT NOT NULL REFERENCES etsy_orders(id) ON DELETE CASCADE,
  transaction_id TEXT,
  amount_minor INTEGER,
  currency TEXT,
  status TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS etsy_fulfilment_outbox (
  id TEXT PRIMARY KEY,
  etsy_order_id TEXT NOT NULL REFERENCES etsy_orders(id) ON DELETE CASCADE,
  etsy_order_unit_id TEXT REFERENCES etsy_order_units(id) ON DELETE CASCADE,
  action TEXT NOT NULL
    CHECK (action IN ('claim_email', 'mp3_ready_email', 'manual_fulfilment')),
  generation INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'uncertain', 'canceled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_etsy_fulfilment_outbox_dedupe
  ON etsy_fulfilment_outbox(
    etsy_order_id,
    COALESCE(etsy_order_unit_id, ''),
    action,
    generation
  );

CREATE TABLE IF NOT EXISTS track_artifacts (
  id TEXT PRIMARY KEY,
  track_version_id TEXT NOT NULL REFERENCES track_versions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('full_mp3', 'preview_mp3')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  storage_key TEXT,
  sha256 TEXT,
  byte_length INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  exhausted_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (track_version_id, kind)
);

INSERT INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES
  ('etsy_entry_enabled', 'false', 'Allows Etsy buyers to request a verified fulfilment claim.', CURRENT_TIMESTAMP, 'migration_137'),
  ('etsy_automation_enabled', 'false', 'Allows automated Etsy webhook ingestion and fulfilment.', CURRENT_TIMESTAMP, 'migration_137'),
  ('etsy_legacy_code_redemption_enabled', 'false', 'Temporary migration-only compatibility for legacy printed codes.', CURRENT_TIMESTAMP, 'migration_137')
ON CONFLICT(id) DO NOTHING;
