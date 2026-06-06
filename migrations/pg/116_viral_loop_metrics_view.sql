-- Viral-loop watch view: the four loop metrics in one place, per time window.
-- Read it with the query  SELECT star FROM viral_loop_metrics  (run via railway connect postgres).
-- NOTE: the migration runner splits SQL on the statement-terminator char, so this file must
-- contain exactly one statement and no terminator chars inside comments.
--
-- Columns map to the four metrics you asked to watch:
--   cta_clicks_to_onelink        -> #1 OneLink clicks (our-side count — AppsFlyer dashboard is authoritative)
--   cta_click_rate_pct           -> #2 recipient CTA click-rate (clicks / views)
--   registered_recipients / _pct -> #3 recipient -> registration (matched_user_id populated by matchReceiverAttribution)
--   reciprocal_song_makers       -> #4 attributed recipients who then created a song (the loop actually turning)
--
-- Non-destructive: a read-only VIEW over receiver_sessions + receiver_session_events + tracks.
-- Windowed by the receiver SESSION's created_at so each row is "for sessions started in this window".
CREATE OR REPLACE VIEW viral_loop_metrics AS
WITH w(window_label, ord, since) AS (
  VALUES
    ('all_time', 1, TIMESTAMPTZ 'epoch'),
    ('last_30d', 2, NOW() - INTERVAL '30 days'),
    ('last_7d',  3, NOW() - INTERVAL '7 days')
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
  ROUND(100.0 * cta_clicks_to_onelink / NULLIF(cta_views, 0), 1)            AS cta_click_rate_pct,
  registered_recipients,
  ROUND(100.0 * registered_recipients / NULLIF(receiver_sessions, 0), 1)    AS recipient_register_rate_pct,
  reciprocal_song_makers
FROM base
ORDER BY ord;
