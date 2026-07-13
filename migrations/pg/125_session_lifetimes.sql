ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS auth_method TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS idle_expires_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_rotated_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS web_session_hash TEXT;

UPDATE user_sessions
SET auth_method = COALESCE(auth_method, 'legacy'),
    platform = COALESCE(platform, 'unknown'),
    authenticated_at = COALESCE(authenticated_at, created_at::timestamptz),
    idle_expires_at = COALESCE(
      idle_expires_at,
      COALESCE(last_active_at, created_at)::timestamptz + INTERVAL '90 days'
    ),
    absolute_expires_at = COALESCE(
      absolute_expires_at,
      created_at::timestamptz + INTERVAL '365 days'
    ),
    last_rotated_at = COALESCE(last_rotated_at, created_at::timestamptz);

CREATE INDEX IF NOT EXISTS idx_user_sessions_lifetime
  ON user_sessions (user_id, idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_web_hash
  ON user_sessions (web_session_hash) WHERE web_session_hash IS NOT NULL;
