CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  locale TEXT,
  country TEXT
);

CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  embedding_ref TEXT,
  quality_score REAL,
  model_version TEXT,
  consent_version TEXT,
  consent_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS enrollment_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_set_id TEXT,
  prompts_json TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  quality_metrics TEXT,
  failure_reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  consent_version TEXT
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS track_versions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  version_num INTEGER NOT NULL,
  parent_version_id TEXT,
  status TEXT NOT NULL,
  render_type TEXT NOT NULL,
  params_json TEXT,
  params_hash TEXT NOT NULL,
  cost_estimate_json TEXT,
  actual_cost_json TEXT,
  storage_ref TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  preview_url TEXT,
  full_url TEXT,
  billing_hold_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_track_versions_unique
  ON track_versions (track_id, version_num);

CREATE INDEX IF NOT EXISTS idx_track_versions_track_id
  ON track_versions (track_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  track_version_id TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  step TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  step_index INTEGER NOT NULL DEFAULT 0,
  step_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_track_version
  ON jobs (track_version_id);

CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  track_version_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL,
  bound_device_id TEXT,
  bound_device_platform TEXT,
  bound_app_version TEXT,
  bound_at TEXT,
  web_stream_allowed INTEGER NOT NULL DEFAULT 1,
  app_save_allowed INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_share_tokens_track
  ON share_tokens (track_id);

CREATE TABLE IF NOT EXISTS share_access_log (
  id TEXT PRIMARY KEY,
  share_token_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_access_token
  ON share_access_log (share_token_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'free',
  credits_balance INTEGER NOT NULL DEFAULT 1,
  credits_used_total INTEGER NOT NULL DEFAULT 0,
  preview_count_today INTEGER NOT NULL DEFAULT 0,
  preview_count_reset_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  track_version_id TEXT NOT NULL,
  credits_held INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  window_start_ms BIGINT NOT NULL,
  window_seconds INTEGER NOT NULL,
  count INTEGER NOT NULL,
  limit_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, action_type, window_start_ms)
);
