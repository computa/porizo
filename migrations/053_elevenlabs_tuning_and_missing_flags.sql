-- Migration 053: ElevenLabs tuning flags + missing vocal polish/enrollment flags
-- Adds ElevenLabs stability/similarity as tunable flags.
-- Inserts all DEFAULTS flags that were missing from the production DB.
-- Values stored as plain strings (JSON.parse compatible).
-- Rollback: DELETE FROM feature_flags WHERE updated_by = 'migration_053';

-- ElevenLabs Voice Changer tuning params (NEW)
INSERT INTO feature_flags (id, value, description, updated_at, updated_by) VALUES
('elevenlabs_stability', '0.4', 'Voice consistency. Low (0.3-0.5) preserves melodic singing contour. High = flat/robotic.', CURRENT_TIMESTAMP, 'migration_053'),
('elevenlabs_similarity_boost', '0.85', 'Voice match strength. Higher = closer to cloned voice.', CURRENT_TIMESTAMP, 'migration_053')
ON CONFLICT (id) DO NOTHING;

-- Vocal polish master switch (missing from DB, was using code default)
INSERT INTO feature_flags (id, value, description, updated_at, updated_by) VALUES
('vocal_polish_enabled', 'true', 'Apply post-processing polish to voice conversion output.', CURRENT_TIMESTAMP, 'migration_053')
ON CONFLICT (id) DO NOTHING;

-- Vocal polish params (missing from DB, were using code defaults)
INSERT INTO feature_flags (id, value, description, updated_at, updated_by) VALUES
('vocal_polish_de_harsh_freq', '3000', 'Center frequency for harshness reduction EQ cut.', CURRENT_TIMESTAMP, 'migration_053'),
('vocal_polish_de_harsh_gain', '-3', 'Harshness reduction gain (dB). More negative = more cut.', CURRENT_TIMESTAMP, 'migration_053'),
('vocal_polish_warmth_freq', '200', 'Center frequency for warmth boost.', CURRENT_TIMESTAMP, 'migration_053'),
('vocal_polish_warmth_gain', '2', 'Warmth boost gain (dB). Higher = warmer.', CURRENT_TIMESTAMP, 'migration_053')
ON CONFLICT (id) DO NOTHING;

-- Timbre blend / perceptual params (missing from DB)
INSERT INTO feature_flags (id, value, description, updated_at, updated_by) VALUES
('perceptual_ai_influence', '0.15', 'AI vocal bleed when user voice is silent. 0=none, 0.5=max.', CURRENT_TIMESTAMP, 'migration_053'),
('perceptual_ducking_strength', '0.85', 'How aggressively AI ducks when user sings. 1=full ducking.', CURRENT_TIMESTAMP, 'migration_053'),
('perceptual_attack_ms', '10', 'How fast ducking kicks in when user starts singing (ms).', CURRENT_TIMESTAMP, 'migration_053'),
('perceptual_release_ms', '150', 'How fast AI returns after user stops singing (ms).', CURRENT_TIMESTAMP, 'migration_053')
ON CONFLICT (id) DO NOTHING;
