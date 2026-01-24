-- Migration: Extend auth_events event_type CHECK constraint
-- Adds: signup_success, orphaned_provider_recovery

-- Drop the existing constraint
ALTER TABLE auth_events DROP CONSTRAINT IF EXISTS auth_events_event_type_check;

-- Add new constraint with extended event types
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_type_check CHECK(event_type IN (
  'login_success', 'login_failed', 'logout',
  'signup_success', 'orphaned_provider_recovery',
  'token_refresh', 'token_revoked', 'token_reuse_detected',
  'password_changed', 'password_reset_requested', 'password_reset_completed',
  'provider_linked', 'provider_unlinked',
  'email_verified', 'account_locked', 'account_unlocked'
));
