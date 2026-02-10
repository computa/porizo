-- Migration 044: Persist story v3 orchestration execution records for admin replay/audit

CREATE TABLE IF NOT EXISTS orchestration_executions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('local', 'external')),
  request_json TEXT NOT NULL,
  result_json TEXT,
  debug_json TEXT,
  error_json TEXT,
  replay_of TEXT REFERENCES orchestration_executions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orchestration_executions_admin_created
  ON orchestration_executions(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestration_executions_status_created
  ON orchestration_executions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestration_executions_replay_of
  ON orchestration_executions(replay_of);
