ALTER TABLE entitlements ADD COLUMN gift_songs_used_total INTEGER NOT NULL DEFAULT 0;

UPDATE entitlements
   SET gift_songs_used_total = COALESCE((
     SELECT COUNT(*)
       FROM gift_wallet_transactions
      WHERE gift_wallet_transactions.user_id = entitlements.user_id
        AND gift_wallet_transactions.type = 'song_spend'
        AND gift_wallet_transactions.amount < 0
   ), 0);

INSERT INTO feature_flags (id, value, updated_at, updated_by)
VALUES ('free_tier_songs_grant', '2', CURRENT_TIMESTAMP, 'migration_117')
ON CONFLICT(id) DO UPDATE SET
  value = '2',
  updated_at = CURRENT_TIMESTAMP,
  updated_by = 'migration_117';

INSERT INTO trial_config (id, songs_allowed, duration_days, is_active, updated_at)
VALUES (1, 0, 7, 0, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  songs_allowed = 0,
  is_active = 0,
  updated_at = CURRENT_TIMESTAMP;

DROP VIEW IF EXISTS user_song_usage_summary;

CREATE VIEW user_song_usage_summary AS
SELECT
  e.user_id,
  e.tier,
  e.songs_remaining,
  e.trial_songs_remaining,
  e.songs_used_total,
  e.gift_songs_used_total,
  CASE
    WHEN e.songs_used_total - e.gift_songs_used_total < 0 THEN 0
    ELSE e.songs_used_total - e.gift_songs_used_total
  END AS non_gift_songs_used_total,
  COALESCE(gw.balance, 0) AS gift_wallet_balance,
  COALESCE(track_counts.tracks_total, 0) AS tracks_total,
  COALESCE(track_counts.draft_tracks_total, 0) AS draft_tracks_total,
  COALESCE(version_counts.versions_total, 0) AS versions_total,
  COALESCE(version_counts.charged_versions_total, 0) AS charged_versions_total,
  COALESCE(version_counts.ready_versions_total, 0) AS ready_versions_total
FROM entitlements e
LEFT JOIN gift_wallet gw ON gw.user_id = e.user_id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS tracks_total,
    SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_tracks_total
  FROM tracks
  WHERE deleted_at IS NULL
  GROUP BY user_id
) track_counts ON track_counts.user_id = e.user_id
LEFT JOIN (
  SELECT
    t.user_id,
    COUNT(tv.id) AS versions_total,
    SUM(CASE WHEN tv.song_entitlement_consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS charged_versions_total,
    SUM(CASE WHEN tv.status IN ('completed', 'preview_ready', 'full_ready') THEN 1 ELSE 0 END) AS ready_versions_total
  FROM tracks t
  JOIN track_versions tv ON tv.track_id = t.id
  WHERE t.deleted_at IS NULL
  GROUP BY t.user_id
) version_counts ON version_counts.user_id = e.user_id;
