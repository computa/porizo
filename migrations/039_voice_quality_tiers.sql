-- Migration 039: Add voice quality tier columns (SQLite version)
-- Part of resilient voice enrollment system

-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
-- These columns may already exist from previous schema

-- Add quality_tier to voice_profiles if not exists
-- Note: SQLite ALTER TABLE ADD COLUMN silently ignores if column exists
ALTER TABLE voice_profiles ADD COLUMN quality_tier TEXT DEFAULT 'basic';
ALTER TABLE voice_profiles ADD COLUMN quality_metrics_json TEXT;

-- Add chunk quality tracking to enrollment_sessions
ALTER TABLE enrollment_sessions ADD COLUMN chunk_quality_json TEXT;

-- Create feature flags table
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

-- Seed voice enrollment feature flags
INSERT OR REPLACE INTO feature_flags (id, value, description) VALUES
  ('voice_enrollment_preprocessing_strategy', '"ffmpeg"', 'Preprocessing pipeline: ffmpeg|ml_server|hybrid'),
  ('voice_enrollment_ml_provider', '"deepfilternet"', 'ML denoiser: deepfilternet|resemble|adobe'),
  ('voice_enrollment_min_tier_for_conversion', '"minimal"', 'Minimum quality tier to accept'),
  ('voice_enrollment_sung_threshold_relaxation', 'true', 'Relaxed thresholds for sung prompts'),
  ('voice_enrollment_sung_weight', '0.6', 'Sung prompt weight in scoring (0-1)'),
  ('voice_enrollment_ios_voice_processing', 'true', 'On-device noise reduction'),
  ('voice_enrollment_ios_realtime_feedback', 'true', 'Real-time recording feedback UI');
