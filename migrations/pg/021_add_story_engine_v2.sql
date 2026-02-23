-- Story Engine V2: Add engine versioning and V2 state storage
-- Enables running V1 and V2 side-by-side with clean separation
--
-- V1 (legacy): Uses elements_json, pending_anchors_json, current_question_json
-- V2 (reasoning engine): Uses v2_state_json with unified state shape
--
-- The engine_version column determines which engine processes the session.
-- Sessions default to v1 for backward compatibility.

-- Add engine version column (v1 = legacy, v2 = reasoning engine)
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS engine_version TEXT NOT NULL DEFAULT 'v1';

-- Add V2 state JSON column (only populated for v2 sessions)
-- Contains: event, facts, narrative, beats, user_model, last_reasoning, conversation
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS v2_state_json TEXT;

-- Index for filtering by engine version (useful for analytics and debugging)
CREATE INDEX IF NOT EXISTS idx_story_sessions_engine_version ON story_sessions(engine_version);
