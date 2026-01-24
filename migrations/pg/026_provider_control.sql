-- Migration 026: Provider and Queue Control Plane
-- Enables admin control over external providers and job queues for incident management

CREATE TABLE IF NOT EXISTS provider_status (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'disabled')),
  paused_at TEXT,
  paused_by TEXT,
  pause_reason TEXT,
  updated_at TEXT NOT NULL
);

-- Insert default providers
INSERT INTO provider_status (id, provider_name, status, updated_at) VALUES
  ('prov_replicate', 'replicate', 'active', CURRENT_TIMESTAMP),
  ('prov_elevenlabs', 'elevenlabs', 'active', CURRENT_TIMESTAMP),
  ('prov_seedvc', 'seed_vc', 'active', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS queue_status (
  id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'draining')),
  paused_at TEXT,
  paused_by TEXT,
  pause_reason TEXT,
  updated_at TEXT NOT NULL
);

-- Insert default queues
INSERT INTO queue_status (id, queue_name, status, updated_at) VALUES
  ('q_enroll_cpu', 'q.enrollment.cpu', 'active', CURRENT_TIMESTAMP),
  ('q_voice_api', 'q.voiceprofile.api', 'active', CURRENT_TIMESTAMP),
  ('q_render_cpu', 'q.render.plan.cpu', 'active', CURRENT_TIMESTAMP),
  ('q_render_music', 'q.render.music.api', 'active', CURRENT_TIMESTAMP),
  ('q_render_convert', 'q.render.convert.api', 'active', CURRENT_TIMESTAMP),
  ('q_moderation', 'q.moderation.cpu', 'active', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;
