-- Repair migration for drifted PostgreSQL environments where schema_migrations
-- claims early core migrations ran, but the base workflow tables were never
-- created in the active schema.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  locale TEXT,
  country TEXT,
  email TEXT,
  email_verified INTEGER DEFAULT 0,
  display_name TEXT,
  avatar_url TEXT,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TEXT,
  deleted_at TEXT,
  phone_number TEXT,
  phone_verified_at TIMESTAMPTZ,
  username TEXT,
  profile_completion_skipped_at TIMESTAMPTZ
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completion_skipped_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone_number) WHERE phone_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email
  ON users(email)
  WHERE email_verified = 1 AND deleted_at IS NULL;

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
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_reason TEXT,
  story_context_json TEXT,
  og_variant TEXT,
  voice_gender TEXT,
  gift_reservation_id TEXT,
  funding_source TEXT NOT NULL DEFAULT 'standard'
);

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS story_context_json TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS og_variant TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS voice_gender TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS gift_reservation_id TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'standard';

-- Migrate any legacy 'gift_token' values (allowed by migration 082's constraint)
-- to 'gift_wallet' (the renamed semantic equivalent in the new model).
-- Must run BEFORE the new CHECK constraint, otherwise existing rows fail the check
-- and the ALTER aborts the entire migration transaction.
UPDATE tracks SET funding_source = 'gift_wallet' WHERE funding_source = 'gift_token';

ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_funding_source_check;
ALTER TABLE tracks
  ADD CONSTRAINT tracks_funding_source_check
  CHECK (funding_source IN ('standard', 'gift_wallet', 'gift_link', 'admin_grant'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_gift_reservation_active
  ON tracks(gift_reservation_id)
  WHERE gift_reservation_id IS NOT NULL AND deleted_at IS NULL;

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
  billing_hold_id TEXT,
  lyrics_json TEXT,
  music_plan_json TEXT,
  moderation_status TEXT,
  moderation_reason TEXT,
  instrumental_url TEXT,
  guide_vocal_url TEXT,
  voice_conversion_url TEXT,
  lyrics_status TEXT,
  lyrics_updated_at TEXT,
  lyrics_approved_at TEXT,
  provenance_json TEXT,
  guide_access_token TEXT,
  moderation_details_json TEXT,
  content_hash TEXT,
  preview_job_id TEXT,
  full_job_id TEXT,
  stream_base_url TEXT,
  cover_image_url TEXT,
  cover_image_small_url TEXT,
  cover_image_large_url TEXT,
  song_entitlement_consumed_at TEXT DEFAULT NULL
);

ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_json TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS music_plan_json TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS moderation_status TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS instrumental_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS guide_vocal_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS voice_conversion_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_status TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_updated_at TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS lyrics_approved_at TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS provenance_json TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS guide_access_token TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS moderation_details_json TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS preview_job_id TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS full_job_id TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS stream_base_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS cover_image_small_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS cover_image_large_url TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS song_entitlement_consumed_at TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_track_versions_unique
  ON track_versions (track_id, version_num);
CREATE INDEX IF NOT EXISTS idx_track_versions_track_id
  ON track_versions (track_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_versions_track_version
  ON track_versions (track_id, version_num);
CREATE INDEX IF NOT EXISTS idx_track_versions_content_hash
  ON track_versions(track_id, content_hash);

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
  updated_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  next_attempt_at TEXT,
  locked_by TEXT,
  locked_at TEXT,
  progress_pct INTEGER,
  started_at TEXT,
  completed_at TEXT,
  last_heartbeat_at TEXT,
  external_task_id TEXT,
  queue_name TEXT
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_attempt_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress_pct INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_task_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS queue_name TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_track_version
  ON jobs (track_version_id);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_name
  ON jobs(queue_name);
