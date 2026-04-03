-- Migration 076: Onboarding audio samples for admin-controlled pre-auth playback

CREATE TABLE IF NOT EXISTS onboarding_samples (
  id TEXT PRIMARY KEY DEFAULT ('os_' || substr(md5(random()::text), 1, 12)),
  label TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (NOW()::text),
  updated_at TEXT DEFAULT (NOW()::text),
  updated_by TEXT,
  CHECK (length(label) <= 200),
  CHECK (length(audio_url) <= 500)
);

INSERT INTO onboarding_samples (id, label, audio_url, is_active)
VALUES ('os_seed01', 'Cafeteria Light (Drive Home Ad)', '/audio/cafeteria-light-trimmed.mp3', 1)
ON CONFLICT DO NOTHING;
