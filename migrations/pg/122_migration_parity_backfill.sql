-- Migration 122: Backfill additive schema/flag parity from historical SQLite-only migrations.
--
-- Do not add new low-number PostgreSQL migrations for these historical local
-- files. Existing production databases have advanced beyond them, and drifted
-- environments rely on 088_repair_core_workflow_tables.sql running before new
-- repair work. This migration is current-numbered, idempotent, and additive.

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  embedding_ref TEXT,
  quality_score REAL,
  quality_tier TEXT DEFAULT 'basic',
  quality_metrics_json TEXT,
  model_version TEXT,
  consent_version TEXT,
  consent_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  elevenlabs_voice_id TEXT
);

ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT;

UPDATE feature_flags
SET value = '0.25',
    updated_at = CURRENT_TIMESTAMP,
    updated_by = 'migration_122'
WHERE id = 'timbre_blend_ratio';

INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('timbre_blend_strategy', '"amplitude"', CURRENT_TIMESTAMP, 'migration_122')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES
  ('spectral_crossover_low_hz', '300', CURRENT_TIMESTAMP, 'migration_122'),
  ('spectral_crossover_high_hz', '3000', CURRENT_TIMESTAMP, 'migration_122'),
  ('spectral_mid_blend_ratio', '0.30', CURRENT_TIMESTAMP, 'migration_122'),
  ('doubling_level', '0.12', CURRENT_TIMESTAMP, 'migration_122'),
  ('doubling_presence_cut_freq', '4000', CURRENT_TIMESTAMP, 'migration_122'),
  ('doubling_presence_cut_gain', '-8', CURRENT_TIMESTAMP, 'migration_122'),
  ('formant_transfer_strength', '0.5', CURRENT_TIMESTAMP, 'migration_122'),
  ('formant_max_gain_db', '12', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_de_ess_freq', '6500', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_de_ess_gain', '-4', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_de_ess_width', '2.0', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_highpass_freq', '80', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_lowpass_freq', '12000', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_compression_ratio', '4', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_compression_threshold', '0.1', CURRENT_TIMESTAMP, 'migration_122'),
  ('seedvc_auto_f0_adjust', 'false', CURRENT_TIMESTAMP, 'migration_122'),
  ('seedvc_f0_condition', 'true', CURRENT_TIMESTAMP, 'migration_122'),
  ('seedvc_pitch_shift', '0', CURRENT_TIMESTAMP, 'migration_122')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES
  ('elevenlabs_stability', '0.4', 'Voice consistency. Low (0.3-0.5) preserves melodic singing contour. High = flat/robotic.', CURRENT_TIMESTAMP, 'migration_122'),
  ('elevenlabs_similarity_boost', '0.85', 'Voice match strength. Higher = closer to cloned voice.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_enabled', 'true', 'Apply post-processing polish to voice conversion output.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_de_harsh_freq', '3000', 'Center frequency for harshness reduction EQ cut.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_de_harsh_gain', '-3', 'Harshness reduction gain (dB). More negative = more cut.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_warmth_freq', '200', 'Center frequency for warmth boost.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_warmth_gain', '2', 'Warmth boost gain (dB). Higher = warmer.', CURRENT_TIMESTAMP, 'migration_122'),
  ('perceptual_ai_influence', '0.15', 'AI vocal bleed when user voice is silent. 0=none, 0.5=max.', CURRENT_TIMESTAMP, 'migration_122'),
  ('perceptual_ducking_strength', '0.85', 'How aggressively AI ducks when user sings. 1=full ducking.', CURRENT_TIMESTAMP, 'migration_122'),
  ('perceptual_attack_ms', '10', 'How fast ducking kicks in when user starts singing (ms).', CURRENT_TIMESTAMP, 'migration_122'),
  ('perceptual_release_ms', '150', 'How fast AI returns after user stops singing (ms).', CURRENT_TIMESTAMP, 'migration_122')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES
  ('vocal_polish_compression_attack', '20', 'Compression attack ms. 20-30 for singing (preserves note onsets). Was hardcoded 5.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_compression_release', '300', 'Compression release ms. 250-400 for singing (lets phrases breathe). Was hardcoded 100.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_compression_knee', '6', 'Compression knee dB. Soft knee for singing dynamics.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_compression_makeup', '3', 'Compression makeup gain dB.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_mud_cut_freq', '300', 'Mud cut EQ center Hz. Removes muddiness before compression.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_mud_cut_gain', '-2', 'Mud cut EQ gain dB.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_presence_freq', '4000', 'Presence EQ center Hz. Additive, applied AFTER compression.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_presence_gain', '2.5', 'Presence EQ boost dB. Adds clarity and forward placement.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_air_freq', '12000', 'Air/shimmer high-shelf Hz. Additive, applied AFTER compression.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_air_gain', '2', 'Air/shimmer shelf boost dB. Adds openness and sparkle.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_saturation', '0.08', 'Saturation amount 0-0.3. Subtle tanh soft-clip for warmth/harmonics. 0=off.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_reverb_enabled', 'true', 'Enable reverb in vocal polish. FFmpeg aecho for now, SoX/Pedalboard later.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_reverb_delay', '25', 'Reverb pre-delay ms. Keeps vocal upfront in the mix.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_reverb_decay', '0.3', 'Reverb decay amount 0.1-0.5. Higher = more room.', CURRENT_TIMESTAMP, 'migration_122'),
  ('vocal_polish_target_lufs', '-16', 'Final loudnorm target LUFS. -16 for vocal delivery, -14 for louder.', CURRENT_TIMESTAMP, 'migration_122')
ON CONFLICT (id) DO NOTHING;

UPDATE feature_flags SET value = '2.5', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_122'
WHERE id = 'vocal_polish_compression_ratio' AND value = '4';

UPDATE feature_flags SET value = '0.06', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_122'
WHERE id = 'vocal_polish_compression_threshold' AND value = '0.1';

UPDATE feature_flags SET value = '7500', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_122'
WHERE id = 'vocal_polish_de_ess_freq' AND value = '6500';

UPDATE feature_flags SET value = '-3', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_122'
WHERE id = 'vocal_polish_de_ess_gain' AND value = '-4';

UPDATE feature_flags SET value = '15000', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_122'
WHERE id = 'vocal_polish_lowpass_freq' AND value = '12000';

UPDATE feature_flags SET value = '1.5', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_122'
WHERE id = 'vocal_polish_warmth_gain' AND value = '2';

ALTER TABLE users ADD COLUMN IF NOT EXISTS onesignal_synced_at TEXT;

CREATE TABLE IF NOT EXISTS push_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT,
  image_url TEXT,
  onesignal_notification_id TEXT,
  sent_at TEXT NOT NULL DEFAULT now(),
  recipients_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_campaigns_sent_at ON push_campaigns(sent_at);

CREATE TABLE IF NOT EXISTS download_events (
  id TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  country TEXT,
  referrer_url TEXT,
  matched_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_download_events_ip_created
  ON download_events (ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_download_events_matched_user
  ON download_events (matched_user_id)
  WHERE matched_user_id IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_campaign TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_country TEXT;

CREATE TABLE IF NOT EXISTS job_step_history (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_step_history_job
  ON job_step_history (job_id, started_at);
