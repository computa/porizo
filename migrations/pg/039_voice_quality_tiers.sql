-- Migration 039: Add voice quality tier columns
-- Part of resilient voice enrollment system

-- Add quality tier columns to voice_profiles
-- quality_score already exists as REAL, keeping it
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS quality_tier TEXT DEFAULT 'basic';
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS quality_metrics_json TEXT;

-- Add per-chunk quality tracking to enrollment_sessions
-- quality_metrics already exists as TEXT, repurposing for detailed metrics
ALTER TABLE enrollment_sessions ADD COLUMN IF NOT EXISTS chunk_quality_json TEXT;

-- Create feature flags table for enrollment configuration
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- Seed voice enrollment feature flags with default values
INSERT INTO feature_flags (id, value, description) VALUES
  ('voice_enrollment_preprocessing_strategy', '"ffmpeg"', 'Preprocessing pipeline: ffmpeg|ml_server|hybrid'),
  ('voice_enrollment_ml_provider', '"deepfilternet"', 'ML denoiser: deepfilternet|resemble|adobe'),
  ('voice_enrollment_min_tier_for_conversion', '"minimal"', 'Minimum quality tier to accept'),
  ('voice_enrollment_sung_threshold_relaxation', 'true', 'Relaxed thresholds for sung prompts'),
  ('voice_enrollment_sung_weight', '0.6', 'Sung prompt weight in scoring (0-1)'),
  ('voice_enrollment_ios_voice_processing', 'true', 'On-device noise reduction'),
  ('voice_enrollment_ios_realtime_feedback', 'true', 'Real-time recording feedback UI')
ON CONFLICT (id) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

-- Create index on feature_flags for fast lookups
CREATE INDEX IF NOT EXISTS idx_feature_flags_id ON feature_flags(id);

-- The PostgreSQL migration runner tokenizes on semicolons, so DO blocks are unsafe here.
ALTER TABLE voice_profiles DROP CONSTRAINT IF EXISTS voice_profiles_quality_tier_check;
ALTER TABLE voice_profiles ADD CONSTRAINT voice_profiles_quality_tier_check
  CHECK (quality_tier IN ('excellent', 'good', 'fair', 'basic', 'minimal'));
