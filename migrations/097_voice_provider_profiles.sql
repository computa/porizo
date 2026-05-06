CREATE TABLE IF NOT EXISTS voice_provider_profiles (
  id TEXT PRIMARY KEY,
  voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CONSTRAINT voice_provider_profiles_provider_check
    CHECK (provider IN ('suno', 'seedvc', 'replicate')),
  provider_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT voice_provider_profiles_status_check
    CHECK (status IN (
      'pending', 'upload_submitted', 'cover_submitted',
      'persona_submitted', 'active', 'failed', 'cancelled',
      'manual_cleanup_required', 'deleted'
    )),
  source_upload_url TEXT,
  source_task_id TEXT,
  source_audio_id TEXT,
  model TEXT,
  consent_scope TEXT,
  metadata_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_voice_provider_profiles_user_provider_status
  ON voice_provider_profiles (user_id, provider, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_provider_profiles_voice_profile
  ON voice_provider_profiles (voice_profile_id, provider, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_provider_profiles_active_unique
  ON voice_provider_profiles (voice_profile_id, provider)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS voice_provider_jobs (
  id TEXT PRIMARY KEY,
  voice_profile_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CONSTRAINT voice_provider_jobs_provider_check
    CHECK (provider IN ('suno', 'seedvc', 'replicate')),
  voice_provider_profile_id TEXT REFERENCES voice_provider_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT voice_provider_jobs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  step TEXT NOT NULL DEFAULT 'prepare_persona'
    CONSTRAINT voice_provider_jobs_step_check
    CHECK (step IN ('prepare_persona', 'generate_persona', 'persona_active', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  step_data TEXT,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  cancellation_requested_at TEXT,
  cancelled_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_voice_provider_jobs_status
  ON voice_provider_jobs (status, provider, updated_at);

CREATE INDEX IF NOT EXISTS idx_voice_provider_jobs_poll
  ON voice_provider_jobs (status, next_attempt_at)
  WHERE locked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_voice_provider_jobs_voice_profile
  ON voice_provider_jobs (voice_profile_id, provider, status);

CREATE TABLE IF NOT EXISTS voice_provider_locks (
  id TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  locked_by TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+5 minutes'))
);
