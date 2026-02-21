-- Migration 055: Singing-optimized vocal polish parameters
-- Rewrites the vocal polish chain from speech-tuned to singing-tuned defaults.
-- Adds: compression attack/release/knee/makeup, mud cut, presence, air, saturation, reverb, target LUFS.
-- Updates: existing defaults that were wrong for singing (compression ratio, de-ess freq, lowpass).

-- New singing-specific flags
INSERT INTO feature_flags (id, value, description) VALUES
  ('vocal_polish_compression_attack', '20', 'Compression attack ms. 20-30 for singing (preserves note onsets). Was hardcoded 5.'),
  ('vocal_polish_compression_release', '300', 'Compression release ms. 250-400 for singing (lets phrases breathe). Was hardcoded 100.'),
  ('vocal_polish_compression_knee', '6', 'Compression knee dB. Soft knee for singing dynamics.'),
  ('vocal_polish_compression_makeup', '3', 'Compression makeup gain dB.'),
  ('vocal_polish_mud_cut_freq', '300', 'Mud cut EQ center Hz. Removes muddiness before compression.'),
  ('vocal_polish_mud_cut_gain', '-2', 'Mud cut EQ gain dB.'),
  ('vocal_polish_presence_freq', '4000', 'Presence EQ center Hz. Additive, applied AFTER compression.'),
  ('vocal_polish_presence_gain', '2.5', 'Presence EQ boost dB. Adds clarity and forward placement.'),
  ('vocal_polish_air_freq', '12000', 'Air/shimmer high-shelf Hz. Additive, applied AFTER compression.'),
  ('vocal_polish_air_gain', '2', 'Air/shimmer shelf boost dB. Adds openness and sparkle.'),
  ('vocal_polish_saturation', '0.08', 'Saturation amount 0-0.3. Subtle tanh soft-clip for warmth/harmonics. 0=off.'),
  ('vocal_polish_reverb_enabled', 'true', 'Enable reverb in vocal polish. FFmpeg aecho for now, SoX/Pedalboard later.'),
  ('vocal_polish_reverb_delay', '25', 'Reverb pre-delay ms. Keeps vocal upfront in the mix.'),
  ('vocal_polish_reverb_decay', '0.3', 'Reverb decay amount 0.1-0.5. Higher = more room.'),
  ('vocal_polish_target_lufs', '-16', 'Final loudnorm target LUFS. -16 for vocal delivery, -14 for louder.')
ON CONFLICT (id) DO NOTHING;

-- Update existing flags to singing-appropriate defaults
UPDATE feature_flags SET value = '2.5' WHERE id = 'vocal_polish_compression_ratio' AND value = '4';
UPDATE feature_flags SET value = '0.06' WHERE id = 'vocal_polish_compression_threshold' AND value = '0.1';
UPDATE feature_flags SET value = '7500' WHERE id = 'vocal_polish_de_ess_freq' AND value = '6500';
UPDATE feature_flags SET value = '-3' WHERE id = 'vocal_polish_de_ess_gain' AND value = '-4';
UPDATE feature_flags SET value = '15000' WHERE id = 'vocal_polish_lowpass_freq' AND value = '12000';
UPDATE feature_flags SET value = '1.5' WHERE id = 'vocal_polish_warmth_gain' AND value = '2';
