-- Common gift-credit reservation and recipient-delivery state (PostgreSQL).

ALTER TABLE gift_reservations ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'interactive_draft';
ALTER TABLE gift_reservations ADD COLUMN IF NOT EXISTS origin_web_order_id TEXT;
DO $$
BEGIN
  ALTER TABLE gift_reservations
    ADD CONSTRAINT chk_gift_reservations_purpose
    CHECK (purpose IN ('interactive_draft', 'paid_web_order'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DROP INDEX IF EXISTS idx_gift_reservations_user_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_reservations_user_active_draft
  ON gift_reservations(user_id)
  WHERE purpose = 'interactive_draft' AND status IN ('reserved', 'content_ready');
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_reservations_web_order
  ON gift_reservations(origin_web_order_id)
  WHERE purpose = 'paid_web_order' AND origin_web_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gift_delivery_preferences (
  gift_reservation_id TEXT PRIMARY KEY REFERENCES gift_reservations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('manual', 'immediate', 'scheduled')),
  channels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_phone TEXT,
  recipient_email TEXT,
  sender_display_name TEXT,
  sender_timezone TEXT,
  send_at TIMESTAMPTZ,
  message TEXT,
  expires_in_days INTEGER NOT NULL DEFAULT 30,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS payment_source TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS funding_model TEXT NOT NULL DEFAULT 'legacy_song_spend';
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS purchase_transaction_id TEXT;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS gift_reservation_id TEXT;
DO $$
BEGIN
  ALTER TABLE web_orders
    ADD CONSTRAINT chk_web_orders_payment_source
    CHECK (payment_source IN ('stripe', 'gift_wallet'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
DO $$
BEGIN
  ALTER TABLE web_orders
    ADD CONSTRAINT chk_web_orders_funding_model
    CHECK (funding_model IN ('legacy_song_spend', 'gift_reservation_v1'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_orders_gift_reservation
  ON web_orders(gift_reservation_id)
  WHERE gift_reservation_id IS NOT NULL;

ALTER TABLE gift_orders ADD COLUMN IF NOT EXISTS origin_web_order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_orders_origin_web_order
  ON gift_orders(origin_web_order_id)
  WHERE origin_web_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_orders_token_transaction
  ON gift_orders(token_transaction_id)
  WHERE token_transaction_id IS NOT NULL;

INSERT INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES (
  'web_automated_gift_delivery',
  'false',
  'Allows explicit recipient SMS/email configuration in the web gift funnel.',
  CURRENT_TIMESTAMP,
  'migration_135'
)
ON CONFLICT(id) DO NOTHING;
