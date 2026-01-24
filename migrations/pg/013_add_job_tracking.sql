ALTER TABLE jobs ADD COLUMN progress_pct INTEGER;
ALTER TABLE jobs ADD COLUMN started_at TEXT;
ALTER TABLE jobs ADD COLUMN completed_at TEXT;
ALTER TABLE jobs ADD COLUMN last_heartbeat_at TEXT;
ALTER TABLE jobs ADD COLUMN external_task_id TEXT;

ALTER TABLE track_versions ADD COLUMN preview_job_id TEXT;
ALTER TABLE track_versions ADD COLUMN full_job_id TEXT;
