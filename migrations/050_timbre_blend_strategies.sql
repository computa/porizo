-- Migration 050: Timbre Tint v3 — Advanced Vocal Blending Strategies
-- Adds switchable blend algorithms: amplitude (current), spectral crossover,
-- compressed vocal doubling, and formant transfer.
-- Switch via admin dropdown. Rollback: SET timbre_blend_strategy = '"amplitude"'.

-- Strategy selector (dropdown in admin UI)
INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('timbre_blend_strategy', '"amplitude"', CURRENT_TIMESTAMP, 'migration_050')
ON CONFLICT (id) DO NOTHING;

-- Spectral Crossover params
INSERT INTO feature_flags (id, value, updated_at, updated_by) VALUES
('spectral_crossover_low_hz', '300', CURRENT_TIMESTAMP, 'migration_050'),
('spectral_crossover_high_hz', '3000', CURRENT_TIMESTAMP, 'migration_050'),
('spectral_mid_blend_ratio', '0.30', CURRENT_TIMESTAMP, 'migration_050')
ON CONFLICT (id) DO NOTHING;

-- Vocal Doubling params
INSERT INTO feature_flags (id, value, updated_at, updated_by) VALUES
('doubling_level', '0.12', CURRENT_TIMESTAMP, 'migration_050'),
('doubling_presence_cut_freq', '4000', CURRENT_TIMESTAMP, 'migration_050'),
('doubling_presence_cut_gain', '-8', CURRENT_TIMESTAMP, 'migration_050')
ON CONFLICT (id) DO NOTHING;

-- Formant Transfer params
INSERT INTO feature_flags (id, value, updated_at, updated_by) VALUES
('formant_transfer_strength', '0.5', CURRENT_TIMESTAMP, 'migration_050'),
('formant_max_gain_db', '12', CURRENT_TIMESTAMP, 'migration_050')
ON CONFLICT (id) DO NOTHING;
