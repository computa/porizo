-- Migration 060: Gift bundles for multi-token consumable purchases

CREATE TABLE IF NOT EXISTS gift_bundles (
  id TEXT PRIMARY KEY DEFAULT ('gb_' || lower(hex(randomblob(6)))),
  product_id TEXT NOT NULL UNIQUE,
  token_count INTEGER NOT NULL CHECK (token_count >= 1 AND token_count <= 10),
  price_cents INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO gift_bundles (product_id, token_count, price_cents, display_name, sort_order, is_active) VALUES
  ('com.porizo.gift_token_oneoff', 1, 0, '1 Gift (Legacy)', 0, 0),
  ('com.porizo.gift_bundle_1', 1, 499, '1 Gift', 1, 1),
  ('com.porizo.gift_bundle_3', 3, 1299, '3 Gifts', 2, 1),
  ('com.porizo.gift_bundle_5', 5, 1799, '5 Gifts', 3, 1)
ON CONFLICT (product_id) DO NOTHING;
