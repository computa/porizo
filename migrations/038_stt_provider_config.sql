-- Migration 038: Speech-to-Text Provider Configuration
-- Enables admin control over STT providers for multi-model support
-- Providers: Apple SpeechAnalyzer (iOS 26+), WhisperKit (on-device), OpenAI Whisper (cloud)

-- Add STT providers to provider_status table
INSERT OR IGNORE INTO provider_status (id, provider_name, status, updated_at) VALUES
  ('prov_stt_apple', 'stt_apple', 'active', datetime('now')),
  ('prov_stt_whisperkit', 'stt_whisperkit', 'active', datetime('now')),
  ('prov_stt_openai', 'stt_openai', 'active', datetime('now'));

-- App config table for complex JSON settings
-- Used for settings that need structured data beyond simple key-value
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Insert default STT configuration
-- Primary: whisperkit (highest accuracy for accents, 2.2% WER)
-- Fallback: openai (cloud-based, always available)
INSERT OR IGNORE INTO app_config (key, value_json, updated_at) VALUES
  ('stt_config', '{"primary_provider":"whisperkit","fallback_provider":"openai","whisperkit_model":"small"}', datetime('now'));
