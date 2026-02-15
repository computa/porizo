-- Migration 046: Runtime music provider routing configuration
-- Enables admin switching of default music provider and style-aware auto-routing.

INSERT OR IGNORE INTO app_config (key, value_json, updated_at) VALUES
  ('music_provider_config', '{"default_provider":"suno","auto_style_routing":true}', datetime('now'));
