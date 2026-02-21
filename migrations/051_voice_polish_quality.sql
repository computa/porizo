-- Migration 051: Voice Polish & Seed-VC Quality Uplift
-- Adds de-essing params, exposes all polish params as flags, unlocks Seed-VC quality ceiling.
-- Values stored as plain strings (JSON.parse compatible).
-- Rollback: DELETE FROM feature_flags WHERE updated_by = 'migration_051';

-- De-essing params (new feature)
INSERT INTO feature_flags (id, value, updated_at, updated_by) VALUES
('vocal_polish_de_ess_freq', '6500', CURRENT_TIMESTAMP, 'migration_051'),
('vocal_polish_de_ess_gain', '-4', CURRENT_TIMESTAMP, 'migration_051'),
('vocal_polish_de_ess_width', '2.0', CURRENT_TIMESTAMP, 'migration_051')
ON CONFLICT (id) DO NOTHING;

-- Previously hardcoded polish params (now tunable)
INSERT INTO feature_flags (id, value, updated_at, updated_by) VALUES
('vocal_polish_highpass_freq', '80', CURRENT_TIMESTAMP, 'migration_051'),
('vocal_polish_lowpass_freq', '12000', CURRENT_TIMESTAMP, 'migration_051'),
('vocal_polish_compression_ratio', '4', CURRENT_TIMESTAMP, 'migration_051'),
('vocal_polish_compression_threshold', '0.1', CURRENT_TIMESTAMP, 'migration_051')
ON CONFLICT (id) DO NOTHING;

-- Seed-VC params (previously hardcoded in voice.js)
INSERT INTO feature_flags (id, value, updated_at, updated_by) VALUES
('seedvc_auto_f0_adjust', 'false', CURRENT_TIMESTAMP, 'migration_051'),
('seedvc_f0_condition', 'true', CURRENT_TIMESTAMP, 'migration_051'),
('seedvc_pitch_shift', '0', CURRENT_TIMESTAMP, 'migration_051')
ON CONFLICT (id) DO NOTHING;
