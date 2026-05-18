-- Migration 112: Letterbox web player rollout flags
--
-- web_player_letterbox_enabled gates the redesigned player.
-- web_player_letterbox_rollout_percent controls deterministic share-id bucketing
-- once the enabled flag is true. Defaults keep production behavior unchanged.

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
