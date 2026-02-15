-- Migration 047: Tune Seed-VC feature flags to production-validated values
-- Migration 040 inserted conservative initial values (cfg_rate=0.4, preview=50, full=100).
-- After pipeline testing, these tuned values produce better voice quality:
--   cfg_rate 0.65: balanced fidelity vs naturalness (was 0.4 = too natural, lost identity)
--   preview 60: enough quality for preview without excessive latency (was 50)
--   full 90: high quality for final render (was 100, lowered slightly for latency)

UPDATE feature_flags
SET value = '0.65', updated_at = datetime('now')
WHERE id = 'seedvc_cfg_rate';

UPDATE feature_flags
SET value = '60', updated_at = datetime('now')
WHERE id = 'seedvc_diffusion_steps_preview';

UPDATE feature_flags
SET value = '90', updated_at = datetime('now')
WHERE id = 'seedvc_diffusion_steps_full';
