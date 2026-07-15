-- Web funnel guest identity, continuity, and cost-control flags (SQLite).

ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'
  CHECK (account_status IN ('active', 'guest'));

CREATE INDEX IF NOT EXISTS idx_users_account_status
  ON users (account_status);

CREATE TABLE IF NOT EXISTS web_guest_devices (
  device_token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  funnel_enabled_at_entry INTEGER NOT NULL DEFAULT 0,
  entry_url TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_guest_devices_session
  ON web_guest_devices (session_id);

INSERT OR IGNORE INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES
  ('web_funnel_enabled', 'false', 'Allow new web funnel guest sessions.', CURRENT_TIMESTAMP, 'migration_131'),
  ('web_funnel_daily_preview_budget', '100', 'Maximum guest preview renders started per UTC day.', CURRENT_TIMESTAMP, 'migration_131');
