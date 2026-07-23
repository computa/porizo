-- Etsy wedge (plan 2026-07-21-001 §0.7.5): one-time redemption codes delivered
-- inside the Etsy order file. A code grants exactly one gift-wallet credit and
-- drops the buyer into the existing /create funnel; the gift_credit order path
-- then spends that credit through the production orchestrator. The atomic
-- status flip (WHERE status = 'unredeemed') is the concurrency guard: exactly
-- one redeemer can win, and the wallet's idempotency key makes the grant
-- replay-safe for the winner's retries.
CREATE TABLE IF NOT EXISTS etsy_redemption_codes (
  code TEXT PRIMARY KEY,
  batch_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unredeemed'
    CHECK (status IN ('unredeemed', 'redeemed', 'void')),
  redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_etsy_redemption_codes_batch
  ON etsy_redemption_codes (batch_label, status);
