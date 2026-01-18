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
INSERT OR IGNORE INTO provider_status (id, provider_name, status, updated_at) VALUES
  ('prov_replicate', 'replicate', 'active', datetime('now')),
  ('prov_elevenlabs', 'elevenlabs', 'active', datetime('now')),
  ('prov_seedvc', 'seed_vc', 'active', datetime('now'));

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
INSERT OR IGNORE INTO queue_status (id, queue_name, status, updated_at) VALUES
  ('q_enroll_cpu', 'q.enrollment.cpu', 'active', datetime('now')),
  ('q_voice_api', 'q.voiceprofile.api', 'active', datetime('now')),
  ('q_render_cpu', 'q.render.plan.cpu', 'active', datetime('now')),
  ('q_render_music', 'q.render.music.api', 'active', datetime('now')),
  ('q_render_convert', 'q.render.convert.api', 'active', datetime('now')),
  ('q_moderation', 'q.moderation.cpu', 'active', datetime('now'));
