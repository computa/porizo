-- 106_cold_email.sql (Postgres)
-- Cold-intro outbound email campaigns. Ports the Python+launchd job
-- (marketing/email/cold-daily-send.py) into the backend so it stops
-- depending on the user's laptop being on.

CREATE TABLE IF NOT EXISTS cold_email_campaigns (
  id TEXT PRIMARY KEY,
  campaign_tag TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_html_path TEXT NOT NULL,
  template_text_path TEXT NOT NULL,
  from_address TEXT NOT NULL DEFAULT 'Ambrose from Porizo <support@porizo.co>',
  reply_to TEXT NOT NULL DEFAULT 'support@porizo.co',
  per_day INTEGER NOT NULL,
  schedule_pace_seconds INTEGER NOT NULL,
  schedule_offset_minutes INTEGER NOT NULL,
  earliest_run_date_utc TEXT,
  fire_after_utc_hour INTEGER NOT NULL DEFAULT 9,
  active INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  last_run_at TEXT,
  last_run_date_utc TEXT,
  last_batch_size INTEGER,
  total_queued INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cold_email_recipients (
  campaign_id TEXT NOT NULL REFERENCES cold_email_campaigns(id) ON DELETE CASCADE,
  index_pos INTEGER NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  sent_at TEXT,
  resend_email_id TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, index_pos)
);

CREATE INDEX IF NOT EXISTS cold_email_recipients_pending_idx
  ON cold_email_recipients(campaign_id, index_pos)
  WHERE sent_at IS NULL;
