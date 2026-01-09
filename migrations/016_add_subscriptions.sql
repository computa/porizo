-- Migration: Add subscriptions and purchase_receipts tables

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  platform TEXT NOT NULL,
  original_transaction_id TEXT,
  latest_transaction_id TEXT,
  original_purchase_date TEXT,
  expires_at TEXT,
  auto_renew_enabled INTEGER NOT NULL DEFAULT 1,
  grace_period_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at ON subscriptions(expires_at);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  transaction_id TEXT NOT NULL UNIQUE,
  original_transaction_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  receipt_data TEXT,
  verification_status TEXT NOT NULL,
  verification_response TEXT,
  purchase_date TEXT NOT NULL,
  expires_date TEXT,
  is_trial INTEGER NOT NULL DEFAULT 0,
  is_upgrade INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_user_id ON purchase_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_transaction ON purchase_receipts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_original_tx ON purchase_receipts(original_transaction_id);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference ON credit_transactions(reference_type, reference_id);
