-- Migration 043: Add shared library membership model
-- Mirrors SQLite migration 043 for PostgreSQL.

ALTER TABLE share_tokens
  ADD COLUMN IF NOT EXISTS bound_user_id TEXT;

CREATE TABLE IF NOT EXISTS track_library_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (origin IN ('created', 'received')),
  share_token_id TEXT REFERENCES share_tokens(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_track_library_user_removed
  ON track_library_entries(user_id, removed_at, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_library_track
  ON track_library_entries(track_id);

CREATE TABLE IF NOT EXISTS poem_library_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poem_id TEXT NOT NULL REFERENCES poems(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (origin IN ('created', 'received')),
  share_token_id TEXT REFERENCES poem_share_tokens(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, poem_id)
);

CREATE INDEX IF NOT EXISTS idx_poem_library_user_removed
  ON poem_library_entries(user_id, removed_at, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_poem_library_poem
  ON poem_library_entries(poem_id);

-- Backfill creator ownership into library tables
INSERT INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT t.user_id, t.id, 'created', t.share_token_id,
       COALESCE(t.created_at::timestamptz, NOW()),
       NULL,
       COALESCE(t.updated_at::timestamptz, t.created_at::timestamptz, NOW())
FROM tracks t
WHERE t.deleted_at IS NULL
ON CONFLICT (user_id, track_id) DO NOTHING;

INSERT INTO poem_library_entries (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT p.user_id, p.id, 'created', p.share_token_id,
       COALESCE(p.created_at::timestamptz, NOW()),
       NULL,
       COALESCE(p.updated_at::timestamptz, p.created_at::timestamptz, NOW())
FROM poems p
WHERE p.deleted_at IS NULL
ON CONFLICT (user_id, poem_id) DO NOTHING;

-- Backfill receivers from claimed shares
INSERT INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT st.bound_user_id, st.track_id, 'received', st.id,
       COALESCE(st.bound_at::timestamptz, st.created_at::timestamptz, t.created_at::timestamptz, NOW()),
       NULL,
       COALESCE(st.bound_at::timestamptz, st.created_at::timestamptz, t.updated_at::timestamptz, NOW())
FROM share_tokens st
JOIN tracks t ON t.id = st.track_id
WHERE st.bound_user_id IS NOT NULL
  AND t.deleted_at IS NULL
ON CONFLICT (user_id, track_id) DO NOTHING;

INSERT INTO poem_library_entries (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
SELECT pst.bound_user_id, pst.poem_id, 'received', pst.id,
       COALESCE(pst.bound_at::timestamptz, pst.created_at::timestamptz, p.created_at::timestamptz, NOW()),
       NULL,
       COALESCE(pst.bound_at::timestamptz, pst.created_at::timestamptz, p.updated_at::timestamptz, NOW())
FROM poem_share_tokens pst
JOIN poems p ON p.id = pst.poem_id
WHERE pst.bound_user_id IS NOT NULL
  AND pst.allow_save = TRUE
  AND p.deleted_at IS NULL
ON CONFLICT (user_id, poem_id) DO NOTHING;
