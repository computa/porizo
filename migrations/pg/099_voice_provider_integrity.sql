-- Migration 099: harden Suno voice-provider state tables (PostgreSQL).

ALTER TABLE voice_provider_jobs
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;

ALTER TABLE voice_provider_locks
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes');

CREATE INDEX IF NOT EXISTS idx_voice_provider_jobs_poll
  ON voice_provider_jobs (status, next_attempt_at) WHERE locked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_provider_profiles_pending_unique
  ON voice_provider_profiles (voice_profile_id, provider)
  WHERE status IN ('pending', 'upload_submitted', 'cover_submitted', 'persona_submitted')
    AND deleted_at IS NULL;

ALTER TABLE voice_provider_profiles
  DROP CONSTRAINT IF EXISTS voice_provider_profiles_user_fk;

ALTER TABLE voice_provider_profiles
  ADD CONSTRAINT voice_provider_profiles_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE voice_provider_profiles
  DROP CONSTRAINT IF EXISTS voice_provider_profiles_voice_profile_fk;

ALTER TABLE voice_provider_profiles
  ADD CONSTRAINT voice_provider_profiles_voice_profile_fk
  FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE voice_provider_profiles
  DROP CONSTRAINT IF EXISTS voice_provider_profiles_provider_check;

ALTER TABLE voice_provider_profiles
  ADD CONSTRAINT voice_provider_profiles_provider_check
  CHECK (provider IN ('suno', 'seedvc', 'replicate')) NOT VALID;

ALTER TABLE voice_provider_jobs
  DROP CONSTRAINT IF EXISTS voice_provider_jobs_user_fk;

ALTER TABLE voice_provider_jobs
  ADD CONSTRAINT voice_provider_jobs_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE voice_provider_jobs
  DROP CONSTRAINT IF EXISTS voice_provider_jobs_voice_profile_fk;

ALTER TABLE voice_provider_jobs
  ADD CONSTRAINT voice_provider_jobs_voice_profile_fk
  FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE voice_provider_jobs
  DROP CONSTRAINT IF EXISTS voice_provider_jobs_profile_fk;

ALTER TABLE voice_provider_jobs
  ADD CONSTRAINT voice_provider_jobs_profile_fk
  FOREIGN KEY (voice_provider_profile_id) REFERENCES voice_provider_profiles(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE voice_provider_jobs
  DROP CONSTRAINT IF EXISTS voice_provider_jobs_provider_check;

ALTER TABLE voice_provider_jobs
  ADD CONSTRAINT voice_provider_jobs_provider_check
  CHECK (provider IN ('suno', 'seedvc', 'replicate')) NOT VALID;

ALTER TABLE voice_provider_jobs
  DROP CONSTRAINT IF EXISTS voice_provider_jobs_status_check;

ALTER TABLE voice_provider_jobs
  ADD CONSTRAINT voice_provider_jobs_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')) NOT VALID;

ALTER TABLE voice_provider_jobs
  DROP CONSTRAINT IF EXISTS voice_provider_jobs_step_check;

ALTER TABLE voice_provider_jobs
  ADD CONSTRAINT voice_provider_jobs_step_check
  CHECK (step IN ('prepare_persona', 'generate_persona', 'persona_active', 'completed')) NOT VALID;

UPDATE track_versions
SET status = 'cancelled'
WHERE status IN ('queued', 'processing')
  AND music_plan_json IS NOT NULL
  AND (
    music_plan_json LIKE '%"pipeline":"provider_audio_personalized_convert"%'
    OR music_plan_json LIKE '%"pipeline": "provider_audio_personalized_convert"%'
    OR music_plan_json LIKE '%"pipeline":"guide_tts_and_voice_convert"%'
    OR music_plan_json LIKE '%"pipeline": "guide_tts_and_voice_convert"%'
  );
