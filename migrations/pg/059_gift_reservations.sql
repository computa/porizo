-- Migration 059: Gift token reservations for prepay-before-create flow

CREATE TABLE IF NOT EXISTS gift_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL, -- reserved | content_ready | finalized | cancelled | expired
  content_type TEXT, -- song | poem
  content_id TEXT,
  version_num INTEGER,
  token_transaction_id TEXT NOT NULL,
  refund_transaction_id TEXT,
  gift_order_id TEXT,
  idempotency_key TEXT,
  expires_at TEXT NOT NULL,
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gift_reservations_user_status
  ON gift_reservations(user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_reservations_user_idempotency
  ON gift_reservations(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_reservations_user_active
  ON gift_reservations(user_id)
  WHERE status IN ('reserved', 'content_ready');
