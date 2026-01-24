-- Story sessions for persistent conversation state
-- Replaces in-memory Map() storage with database persistence

CREATE TABLE IF NOT EXISTS story_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Session state
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ready_for_confirm', 'confirmed', 'cancelled', 'expired')),
  arc TEXT NOT NULL,
  occasion TEXT,
  recipient_name TEXT NOT NULL,
  style TEXT,

  -- Story data
  initial_prompt TEXT NOT NULL,
  elements_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  additional_notes TEXT,

  -- Q&A state
  pending_anchors_json TEXT DEFAULT '[]',
  current_question_json TEXT,
  question_count INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_sessions_user ON story_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_story_sessions_status ON story_sessions(status);
CREATE INDEX IF NOT EXISTS idx_story_sessions_expires ON story_sessions(expires_at);

-- Conversation turns for audit trail and context
CREATE TABLE IF NOT EXISTS story_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,

  -- Question data
  question TEXT NOT NULL,
  element_target TEXT,
  is_follow_up INTEGER NOT NULL DEFAULT 0,
  anchor_word TEXT,

  -- Answer data
  answer TEXT,
  extracted_signals_json TEXT,

  -- Timestamps
  asked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT,

  UNIQUE (session_id, turn_number)
);

CREATE INDEX IF NOT EXISTS idx_story_turns_session ON story_turns(session_id);
