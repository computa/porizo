-- Migration 115: users.unsubscribed_at (PostgreSQL)
-- Per-user email suppression flag for lifecycle emails (e.g. share follow-ups).
-- NULL = subscribed. The share-followups job skips rows where this is set
-- (skip_reason='unsubscribed'). The 114_share_followups feature assumed this
-- column existed, but it never did, which crashed the daily job on every run.
-- See docs/plans/2026-05-22-share-email-followup-sequence.md (Unsubscribe handling).

ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
