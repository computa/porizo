-- Web funnel commerce catalog + order state machine (SQLite).
--
-- web_products mirrors the gift_bundles concept (migration 060) so the
-- Stripe-granted token reuses the shared gift-wallet grant path. display_price
-- is stored server-side because the localized price string cannot be fetched
-- from the Stripe Price object during offline tests or a webhook-lost recovery.
CREATE TABLE IF NOT EXISTS web_products (
  id TEXT PRIMARY KEY,
  stripe_price_id TEXT NOT NULL UNIQUE,
  price_key TEXT NOT NULL UNIQUE,
  token_count INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  display_price TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- web_orders is the post-payment state machine. status transitions:
--   pending -> paid -> rendering -> delivered
--   pending -> abandoned (checkout expired)
--   rendering -> failed -> refunded (render exhausted retries)
--   paid|delivered -> refunded (charge.refunded / dispute)
-- render_attempts counts orchestrator-level render retries (beyond the
-- pipeline's own internal retries) so a crash-resume does not lose the count.
CREATE TABLE IF NOT EXISTS web_orders (
  id TEXT PRIMARY KEY,
  checkout_session_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  track_version_id TEXT NOT NULL,
  price_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  email TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'paid', 'rendering', 'delivered',
      'failed', 'refunded', 'abandoned'
    )),
  render_attempts INTEGER NOT NULL DEFAULT 0,
  share_token_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_web_orders_user
  ON web_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_web_orders_status
  ON web_orders (status, updated_at);
-- Single open pending order per (user, version): prevents the two-tab
-- duplicate-checkout race. Partial unique index so terminal orders don't block
-- a later re-purchase attempt of the same version.
CREATE UNIQUE INDEX IF NOT EXISTS uq_web_orders_open_pending
  ON web_orders (user_id, track_version_id)
  WHERE status = 'pending';

-- Seed the launch product. stripe_price_id is a placeholder until the real
-- Stripe Price is created; active=0 keeps it out of /web/products until the
-- operator swaps in the live price id and flips active=1.
INSERT OR IGNORE INTO web_products (
  id, stripe_price_id, price_key, token_count, display_name, display_price, currency, active
) VALUES (
  'wprod_gift_song', 'price_PLACEHOLDER', 'gift_song', 1,
  'Gift Song', '$19.99', 'usd', 0
);
