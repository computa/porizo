ALTER TABLE user_sessions ADD COLUMN auth_method TEXT;
ALTER TABLE user_sessions ADD COLUMN platform TEXT;
ALTER TABLE user_sessions ADD COLUMN authenticated_at TEXT;
ALTER TABLE user_sessions ADD COLUMN idle_expires_at TEXT;
ALTER TABLE user_sessions ADD COLUMN absolute_expires_at TEXT;
ALTER TABLE user_sessions ADD COLUMN last_rotated_at TEXT;
ALTER TABLE user_sessions ADD COLUMN web_session_hash TEXT;

UPDATE user_sessions
SET auth_method = COALESCE(auth_method, 'legacy'),
    platform = COALESCE(platform, 'unknown'),
    authenticated_at = COALESCE(authenticated_at, created_at),
    idle_expires_at = COALESCE(idle_expires_at, datetime(COALESCE(last_active_at, created_at), '+90 days')),
    absolute_expires_at = COALESCE(absolute_expires_at, datetime(created_at, '+365 days')),
    last_rotated_at = COALESCE(last_rotated_at, created_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_lifetime
  ON user_sessions (user_id, idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_web_hash
  ON user_sessions (web_session_hash) WHERE web_session_hash IS NOT NULL;
