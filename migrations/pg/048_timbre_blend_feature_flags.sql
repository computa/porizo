-- Migration 048: Timbre blending feature flags for personalized voice pipeline
-- These control the "tint, don't replace" approach to voice personalization:
--   timbre_blend_ratio: blend between AI vocals and converted vocals (0.6 = 60% converted + 40% AI)
--   timbre_cfg_rate: gentler Seed-VC cfg when blending active (cover mode, preserves singing quality)

INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('timbre_blend_ratio', '0.6', CURRENT_TIMESTAMP, 'migration_048')
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('timbre_cfg_rate', '0.35', CURRENT_TIMESTAMP, 'migration_048')
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
