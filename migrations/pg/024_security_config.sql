-- Migration 024: Security Configuration Table
-- Stores editable security settings (session duration, lockout, rate limits)

CREATE TABLE IF NOT EXISTS security_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  session_duration_hours INTEGER NOT NULL DEFAULT 8,
  max_failed_logins INTEGER NOT NULL DEFAULT 5,
  lockout_minutes INTEGER NOT NULL DEFAULT 15,
  rate_limit_defaults_json TEXT,
  updated_at TEXT,
  updated_by TEXT REFERENCES admin_users(id)
);

-- Insert default config
INSERT INTO security_config (id, session_duration_hours, max_failed_logins, lockout_minutes, rate_limit_defaults_json)
VALUES (
  'default',
  8,
  5,
  15,
  '{"enrollment_start":{"limit":3,"windowSeconds":86400},"render_preview":{"limit":20,"windowSeconds":86400},"track_create":{"limit":20,"windowSeconds":3600}}'
) ON CONFLICT (id) DO NOTHING;
