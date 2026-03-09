-- PostgreSQL Initial Schema Migration
-- Consolidated from SQLite migrations 001-014
-- Compatible with PostgreSQL 15+

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  risk_level TEXT NOT NULL DEFAULT 'low',
  locale TEXT,
  country TEXT
);

-- Voice profiles for voice cloning
CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  embedding_ref TEXT,
  quality_score NUMERIC,
  model_version TEXT,
  consent_version TEXT,
  consent_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_id ON voice_profiles(user_id);

-- Enrollment sessions for voice profile creation
CREATE TABLE IF NOT EXISTS enrollment_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  prompt_set_id TEXT,
  prompts_json JSONB,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  quality_metrics JSONB,
  failure_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT,
  access_token TEXT
);

CREATE INDEX IF NOT EXISTS idx_enrollment_sessions_user_id ON enrollment_sessions(user_id);

-- Tracks (songs)
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  title TEXT,
  occasion TEXT,
  recipient_name TEXT,
  style TEXT,
  duration_target INTEGER,
  voice_mode TEXT,
  message TEXT,
  share_token_id TEXT,
  latest_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_reason TEXT,
  story_context_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id);

-- Track versions (renders)
CREATE TABLE IF NOT EXISTS track_versions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  version_num INTEGER NOT NULL,
  parent_version_id TEXT,
  status TEXT NOT NULL,
  render_type TEXT NOT NULL,
  params_json JSONB,
  params_hash TEXT NOT NULL,
  cost_estimate_json JSONB,
  actual_cost_json JSONB,
  storage_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  preview_url TEXT,
  full_url TEXT,
  billing_hold_id TEXT,
  lyrics_json JSONB,
  music_plan_json JSONB,
  moderation_status TEXT,
  moderation_reason TEXT,
  instrumental_url TEXT,
  guide_vocal_url TEXT,
  voice_conversion_url TEXT,
  lyrics_status TEXT,
  lyrics_updated_at TIMESTAMPTZ,
  lyrics_approved_at TIMESTAMPTZ,
  provenance_json JSONB,
  guide_access_token TEXT,
  moderation_details_json JSONB,
  content_hash TEXT,
  preview_job_id TEXT,
  full_job_id TEXT,
  song_entitlement_consumed_at TIMESTAMPTZ,
  stream_base_url TEXT,
  UNIQUE (track_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_track_versions_track_id ON track_versions(track_id);
CREATE INDEX IF NOT EXISTS idx_track_versions_content_hash ON track_versions(track_id, content_hash);

-- Jobs (workflow tasks)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  track_version_id TEXT NOT NULL REFERENCES track_versions(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  step TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  step_index INTEGER NOT NULL DEFAULT 0,
  step_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_code TEXT,
  error_message TEXT,
  next_attempt_at TIMESTAMPTZ,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  progress_pct INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  external_task_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_track_version ON jobs(track_version_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_next_attempt ON jobs(next_attempt_at) WHERE status = 'pending';

-- Share tokens for sharing tracks
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  track_version_id TEXT NOT NULL REFERENCES track_versions(id),
  creator_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  bound_device_id TEXT,
  bound_device_platform TEXT,
  bound_app_version TEXT,
  bound_at TIMESTAMPTZ,
  web_stream_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  app_save_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  stream_key_id TEXT,
  stream_key TEXT,
  claim_pin TEXT,
  claim_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_share_tokens_track ON share_tokens(track_id);

-- Share access log for auditing
CREATE TABLE IF NOT EXISTS share_access_log (
  id TEXT PRIMARY KEY,
  share_token_id TEXT NOT NULL REFERENCES share_tokens(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_access_token ON share_access_log(share_token_id);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- User entitlements (subscription/credits)
CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free',
  credits_balance INTEGER NOT NULL DEFAULT 1,
  credits_used_total INTEGER NOT NULL DEFAULT 0,
  preview_count_today INTEGER NOT NULL DEFAULT 0,
  preview_count_reset_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Billing holds for credit reservation
CREATE TABLE IF NOT EXISTS billing_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_version_id TEXT NOT NULL REFERENCES track_versions(id),
  credits_held INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_holds_user_id ON billing_holds(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_holds_status ON billing_holds(status);

-- Rate limits
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  window_start_ms BIGINT NOT NULL,
  window_seconds INTEGER NOT NULL,
  count INTEGER NOT NULL,
  limit_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, action_type, window_start_ms)
);

-- Share events for rate limiting and audit
CREATE TABLE IF NOT EXISTS share_events (
  id SERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_events_key ON share_events(event_key, event_type, created_at);
