-- 045_orchestration_execution_events.sql
-- Step-by-step timeline events for orchestration executions.

CREATE TABLE IF NOT EXISTS orchestration_execution_events (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES orchestration_executions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestration_execution_events_execution_sequence
  ON orchestration_execution_events(execution_id, sequence);

CREATE INDEX IF NOT EXISTS idx_orchestration_execution_events_execution_created
  ON orchestration_execution_events(execution_id, created_at);
