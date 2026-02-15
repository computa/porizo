-- Migration 049: Timbre Tint v2 — AI vocal as photograph, user timbre as color filter
-- Reduces blend ratio from 0.6 (duet) to 0.25 (subtle tint).
-- cfg_rate stays at 0.35 (cover mode) — no change needed.
--
-- At blend=0.25 + cfg=0.35: one polished AI voice with subtle user coloring.
-- Rollback: SET value = '0.6' for timbre_blend_ratio, or '1.0' to disable entirely.

UPDATE feature_flags SET value = '0.25', updated_at = CURRENT_TIMESTAMP, updated_by = 'migration_049'
WHERE id = 'timbre_blend_ratio';
