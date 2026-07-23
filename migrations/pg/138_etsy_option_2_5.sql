-- Option 2.5: manually issued codes now, provider automation later.

CREATE TABLE IF NOT EXISTS etsy_code_claims (
  id TEXT PRIMARY KEY,
  magic_transaction_id TEXT NOT NULL UNIQUE
    REFERENCES magic_login_transactions(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES etsy_redemption_codes(code),
  email_normalized TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_etsy_code_claims_pending_email
  ON etsy_code_claims(email_normalized, expires_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_etsy_code_claims_one_pending_per_code
  ON etsy_code_claims(code)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS etsy_code_assignments (
  code TEXT PRIMARY KEY REFERENCES etsy_redemption_codes(code),
  receipt_id TEXT NOT NULL UNIQUE,
  listing_id TEXT,
  state TEXT NOT NULL DEFAULT 'assigned'
    CHECK (state IN (
      'assigned',
      'delivered',
      'redeemed',
      'canceled',
      'refunded',
      'manual_review'
    )),
  assigned_by_admin_id TEXT NOT NULL,
  delivery_reference TEXT,
  refund_evidence TEXT,
  assigned_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_etsy_code_assignments_state
  ON etsy_code_assignments(state, assigned_at);

INSERT INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES (
  'etsy_fulfilment_mode',
  '"off"',
  'Etsy fulfilment authority: off, code, or api.',
  CURRENT_TIMESTAMP,
  'migration_138'
)
ON CONFLICT(id) DO NOTHING;
