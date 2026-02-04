-- Migration 040: Seed-VC Feature Flags
-- Add runtime-configurable voice conversion parameters

-- Insert SEEDVC feature flags with descriptions
INSERT INTO feature_flags (id, value, description, updated_at)
VALUES
  ('seedvc_cfg_rate', '0.4', 'Voice fidelity vs natural singing (0.1-1.0). Lower=natural, higher=similar', NOW()),
  ('seedvc_diffusion_steps_preview', '50', 'Diffusion steps for preview (10-200). Higher=better quality', NOW()),
  ('seedvc_diffusion_steps_full', '100', 'Diffusion steps for full render (25-300). Higher=better quality', NOW())
ON CONFLICT (id) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = NOW();
