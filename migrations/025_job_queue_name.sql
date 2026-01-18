-- Migration 025: Add queue_name to jobs for queue-level metrics
-- This enables per-queue monitoring of success rates, latencies, and throughput

ALTER TABLE jobs ADD COLUMN queue_name TEXT;

-- Create index for queue-based queries
CREATE INDEX IF NOT EXISTS idx_jobs_queue_name ON jobs(queue_name);

-- Backfill existing jobs based on workflow_type and step
UPDATE jobs SET queue_name =
  CASE
    WHEN workflow_type = 'enrollment' AND step LIKE '%qc%' THEN 'q.enrollment.cpu'
    WHEN workflow_type = 'enrollment' AND step LIKE '%embed%' THEN 'q.voiceprofile.api'
    WHEN workflow_type = 'preview' AND step IN ('lyrics', 'music_plan', 'moderation') THEN 'q.render.plan.cpu'
    WHEN workflow_type = 'preview' AND step IN ('instrumental', 'guide_vocal') THEN 'q.render.music.api'
    WHEN workflow_type = 'preview' AND step = 'voice_convert' THEN 'q.render.convert.api'
    WHEN workflow_type = 'full_render' THEN 'q.render.convert.api'
    ELSE 'q.default'
  END
WHERE queue_name IS NULL;
