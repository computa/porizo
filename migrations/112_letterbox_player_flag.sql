-- Migration 112: Letterbox web player rollout flags (SQLite)
--
-- Mirrors the PostgreSQL rollout flags so local/dev databases expose the same
-- feature-flag contract as production. Defaults keep behavior unchanged.

INSERT INTO feature_flags (id, value, description, updated_at, updated_by)
VALUES
  (
    'web_player_letterbox_enabled',
    'false',
    'Enable the Letterbox web player redesign for rolled-out share links.',
    CURRENT_TIMESTAMP,
    'migration_112'
  ),
  (
    'web_player_letterbox_rollout_percent',
    '0',
    'Deterministic rollout percentage for the Letterbox web player when enabled.',
    CURRENT_TIMESTAMP,
    'migration_112'
  )
ON CONFLICT (id) DO NOTHING;
