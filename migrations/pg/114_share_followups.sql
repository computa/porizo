-- Migration 114: share_followups (PostgreSQL)
-- Schedules a 3-stage email sequence (sender_24h, sender_72h, sender_7d) for
-- every newly created share token. See docs/plans/2026-05-22-share-email-
-- followup-sequence.md for the integration plan.

CREATE TABLE IF NOT EXISTS share_followups (
  id TEXT PRIMARY KEY,
  share_token_id TEXT NOT NULL REFERENCES share_tokens(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  resend_email_id TEXT,
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (share_token_id, stage)
);

CREATE INDEX IF NOT EXISTS share_followups_pending_idx
  ON share_followups(send_at)
  WHERE sent_at IS NULL AND skip_reason IS NULL;
