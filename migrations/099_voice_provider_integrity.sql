-- Migration 099: harden Suno voice-provider state tables (SQLite).

CREATE INDEX IF NOT EXISTS idx_voice_provider_jobs_poll
  ON voice_provider_jobs (status, next_attempt_at)
  WHERE locked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_provider_profiles_pending_unique
  ON voice_provider_profiles (voice_profile_id, provider)
  WHERE status IN ('pending', 'upload_submitted', 'cover_submitted', 'persona_submitted')
    AND deleted_at IS NULL;

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
