-- Optimistic locking for story sessions
-- Prevents concurrent /continue requests from silently overwriting each other's state.
-- Every UPDATE must pass the expected version. Mismatches return 0 rows changed (HTTP 409).
ALTER TABLE story_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
