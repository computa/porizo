-- SQLite twin of pg/136. Etsy one-time redemption codes; see the pg file for
-- rationale. No FK action difference matters here: SQLite tests exercise the
-- claim/grant logic, prod runs Postgres.
CREATE TABLE IF NOT EXISTS etsy_redemption_codes (
  code TEXT PRIMARY KEY,
  batch_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unredeemed'
    CHECK (status IN ('unredeemed', 'redeemed', 'void')),
  redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_etsy_redemption_codes_batch
  ON etsy_redemption_codes (batch_label, status);
