-- Migration 056: Scheduled gifting + one-off gift wallet

-- Extend track share tokens with delivery metadata
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS delivery_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS gift_order_id TEXT;
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS claim_policy TEXT NOT NULL DEFAULT 'default';
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS dispatch_at TEXT;
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS dispatched_at TEXT;

-- Extend poem share tokens with delivery metadata
ALTER TABLE poem_share_tokens ADD COLUMN IF NOT EXISTS delivery_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE poem_share_tokens ADD COLUMN IF NOT EXISTS gift_order_id TEXT;
ALTER TABLE poem_share_tokens ADD COLUMN IF NOT EXISTS claim_policy TEXT NOT NULL DEFAULT 'default';
ALTER TABLE poem_share_tokens ADD COLUMN IF NOT EXISTS dispatch_at TEXT;
ALTER TABLE poem_share_tokens ADD COLUMN IF NOT EXISTS dispatched_at TEXT;

-- Gift wallet (balance cache)
CREATE TABLE IF NOT EXISTS gift_wallet (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Gift wallet immutable ledger
CREATE TABLE IF NOT EXISTS gift_wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source TEXT,
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  metadata_json TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gift_wallet_tx_user ON gift_wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_wallet_tx_type ON gift_wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_gift_wallet_tx_ref ON gift_wallet_transactions(reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_wallet_tx_idempotency
  ON gift_wallet_transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Scheduled gift orders
CREATE TABLE IF NOT EXISTS gift_orders (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL,
  content_type TEXT NOT NULL, -- song | poem
  content_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | dispatching | dispatched | cancelled | failed | dispatch_retry
  dispatch_status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | retrying | failed | cancelled
  delivery_mode TEXT NOT NULL, -- immediate | scheduled
  send_at TEXT NOT NULL,
  sender_timezone TEXT NOT NULL,
  channels_json TEXT NOT NULL, -- JSON array: ["sms","email"]
  recipient_phone TEXT,
  recipient_email TEXT,
  message TEXT,
  share_token_id TEXT,
  share_url TEXT,
  claim_pin TEXT,
  claim_policy TEXT NOT NULL DEFAULT 'app_only',
  expires_in_days INTEGER NOT NULL DEFAULT 30,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  last_dispatch_error TEXT,
  dispatched_at TEXT,
  cancelled_at TEXT,
  token_transaction_id TEXT,
  refund_transaction_id TEXT,
  version_num INTEGER,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gift_orders_sender_created
  ON gift_orders(sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_orders_status_send_at
  ON gift_orders(status, send_at);
CREATE INDEX IF NOT EXISTS idx_gift_orders_share_token
  ON gift_orders(share_token_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_orders_sender_idempotency
  ON gift_orders(sender_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Delivery attempts per channel
CREATE TABLE IF NOT EXISTS gift_dispatch_attempts (
  id TEXT PRIMARY KEY,
  gift_order_id TEXT NOT NULL,
  channel TEXT NOT NULL, -- sms | email
  status TEXT NOT NULL, -- success | failed
  provider_message_id TEXT,
  error_message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gift_dispatch_attempts_gift
  ON gift_dispatch_attempts(gift_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_dispatch_attempts_channel
  ON gift_dispatch_attempts(channel, created_at DESC);
