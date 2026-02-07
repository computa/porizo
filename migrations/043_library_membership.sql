-- Migration 043: Add shared library membership model
-- Purpose:
-- 1) Track/poem library should include both created and received items
-- 2) Deleting from library should be per-user and not globally delete canonical content
-- 3) Song shares should bind to a user (not only device)

ALTER TABLE share_tokens ADD COLUMN bound_user_id TEXT;

CREATE TABLE IF NOT EXISTS track_library_entries (
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('created', 'received')),
  share_token_id TEXT,
  added_at TEXT NOT NULL,
  removed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_track_library_user_removed
  ON track_library_entries(user_id, removed_at, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_library_track
  ON track_library_entries(track_id);

CREATE TABLE IF NOT EXISTS poem_library_entries (
  user_id TEXT NOT NULL,
  poem_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('created', 'received')),
  share_token_id TEXT,
  added_at TEXT NOT NULL,
  removed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, poem_id)
);

CREATE INDEX IF NOT EXISTS idx_poem_library_user_removed
  ON poem_library_entries(user_id, removed_at, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_poem_library_poem
  ON poem_library_entries(poem_id);

-- Backfill creator ownership into library tables
INSERT OR IGNORE INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT t.user_id, t.id, 'created', t.share_token_id, COALESCE(t.created_at, CURRENT_TIMESTAMP), NULL, COALESCE(t.updated_at, t.created_at, CURRENT_TIMESTAMP)
FROM tracks t
WHERE t.deleted_at IS NULL;

INSERT OR IGNORE INTO poem_library_entries (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT p.user_id, p.id, 'created', p.share_token_id, COALESCE(p.created_at, CURRENT_TIMESTAMP), NULL, COALESCE(p.updated_at, p.created_at, CURRENT_TIMESTAMP)
FROM poems p
WHERE p.deleted_at IS NULL;

-- Backfill receivers from claimed shares
INSERT OR IGNORE INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT st.bound_user_id, st.track_id, 'received', st.id,
       COALESCE(st.bound_at, st.created_at, t.created_at, CURRENT_TIMESTAMP),
       NULL,
       COALESCE(st.bound_at, st.created_at, t.updated_at, CURRENT_TIMESTAMP)
FROM share_tokens st
JOIN tracks t ON t.id = st.track_id
WHERE st.bound_user_id IS NOT NULL
  AND t.deleted_at IS NULL;

INSERT OR IGNORE INTO poem_library_entries (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT pst.bound_user_id, pst.poem_id, 'received', pst.id,
       COALESCE(pst.bound_at, pst.created_at, p.created_at, CURRENT_TIMESTAMP),
       NULL,
       COALESCE(pst.bound_at, pst.created_at, p.updated_at, CURRENT_TIMESTAMP)
FROM poem_share_tokens pst
JOIN poems p ON p.id = pst.poem_id
WHERE pst.bound_user_id IS NOT NULL
  AND pst.allow_save = 1
  AND p.deleted_at IS NULL;
