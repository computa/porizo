-- Viral-loop watch view for SQLite local/dev parity with PostgreSQL.

CREATE VIEW IF NOT EXISTS viral_loop_metrics AS
WITH w(window_label, ord, since) AS (
  SELECT 'all_time', 1, '0000-01-01T00:00:00Z'
  UNION ALL
  SELECT 'last_30d', 2, datetime('now', '-30 days')
  UNION ALL
  SELECT 'last_7d', 3, datetime('now', '-7 days')
),
base AS (
  SELECT
    w.window_label,
    w.ord,
    (SELECT COUNT(*) FROM receiver_sessions rs
       WHERE rs.created_at >= w.since) AS receiver_sessions,
    (SELECT COUNT(*) FROM receiver_session_events e
       JOIN receiver_sessions rs ON rs.id = e.receiver_session_id
       WHERE e.event_name = 'receiver_save_cta_viewed' AND rs.created_at >= w.since) AS cta_views,
    (SELECT COUNT(*) FROM receiver_session_events e
       JOIN receiver_sessions rs ON rs.id = e.receiver_session_id
       WHERE e.event_name = 'receiver_save_cta_clicked' AND rs.created_at >= w.since) AS cta_clicks_to_onelink,
    (SELECT COUNT(*) FROM receiver_sessions rs
       WHERE rs.matched_user_id IS NOT NULL AND rs.created_at >= w.since) AS registered_recipients,
    (SELECT COUNT(DISTINCT rs.matched_user_id) FROM receiver_sessions rs
       JOIN tracks t ON t.user_id = rs.matched_user_id
       WHERE rs.matched_user_id IS NOT NULL AND rs.created_at >= w.since) AS reciprocal_song_makers
  FROM w
)
SELECT
  window_label,
  receiver_sessions,
  cta_views,
  cta_clicks_to_onelink,
  ROUND(100.0 * cta_clicks_to_onelink / NULLIF(cta_views, 0), 1) AS cta_click_rate_pct,
  registered_recipients,
  ROUND(100.0 * registered_recipients / NULLIF(receiver_sessions, 0), 1) AS recipient_register_rate_pct,
  reciprocal_song_makers
FROM base
ORDER BY ord;
