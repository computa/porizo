-- Prevent new account-owned rows from being attached to a soft-deleted user.
-- Account deletion takes table locks before setting users.deleted_at; these
-- guards reject blocked/new inserts once the deletion transaction commits.

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_story_sessions_user_id_ins
BEFORE INSERT ON story_sessions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_tracks_user_id_ins
BEFORE INSERT ON tracks
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_poems_user_id_ins
BEFORE INSERT ON poems
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_share_tokens_creator_id_ins
BEFORE INSERT ON share_tokens
WHEN NEW.creator_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.creator_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_share_tokens_bound_user_id_ins
BEFORE INSERT ON share_tokens
WHEN NEW.bound_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.bound_user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_poem_share_tokens_creator_id_ins
BEFORE INSERT ON poem_share_tokens
WHEN NEW.creator_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.creator_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_poem_share_tokens_bound_user_id_ins
BEFORE INSERT ON poem_share_tokens
WHEN NEW.bound_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.bound_user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_track_library_entries_user_id_ins
BEFORE INSERT ON track_library_entries
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_poem_library_entries_user_id_ins
BEFORE INSERT ON poem_library_entries
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_gift_orders_sender_user_id_ins
BEFORE INSERT ON gift_orders
WHEN NEW.sender_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.sender_user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_gift_reservations_user_id_ins
BEFORE INSERT ON gift_reservations
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_gift_wallet_user_id_ins
BEFORE INSERT ON gift_wallet
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_gift_wallet_transactions_user_id_ins
BEFORE INSERT ON gift_wallet_transactions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_billing_holds_user_id_ins
BEFORE INSERT ON billing_holds
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_credit_transactions_user_id_ins
BEFORE INSERT ON credit_transactions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_song_transactions_user_id_ins
BEFORE INSERT ON song_transactions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_purchase_receipts_user_id_ins
BEFORE INSERT ON purchase_receipts
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_subscriptions_user_id_ins
BEFORE INSERT ON subscriptions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_webhook_notifications_user_id_ins
BEFORE INSERT ON webhook_notifications
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_entitlements_user_id_ins
BEFORE INSERT ON entitlements
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_devices_user_id_ins
BEFORE INSERT ON devices
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_apple_ads_attribution_user_id_ins
BEFORE INSERT ON apple_ads_attribution
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_download_events_matched_user_id_ins
BEFORE INSERT ON download_events
WHEN NEW.matched_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.matched_user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_events_user_id_ins
BEFORE INSERT ON events
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_receiver_sessions_matched_user_id_ins
BEFORE INSERT ON receiver_sessions
WHEN NEW.matched_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.matched_user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_enrollment_sessions_user_id_ins
BEFORE INSERT ON enrollment_sessions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_voice_profiles_user_id_ins
BEFORE INSERT ON voice_profiles
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_voice_provider_profiles_user_id_ins
BEFORE INSERT ON voice_provider_profiles
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_voice_provider_jobs_user_id_ins
BEFORE INSERT ON voice_provider_jobs
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_rate_limits_user_id_ins
BEFORE INSERT ON rate_limits
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_user_sessions_user_id_ins
BEFORE INSERT ON user_sessions
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_token_families_user_id_ins
BEFORE INSERT ON token_families
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_refresh_tokens_user_id_ins
BEFORE INSERT ON refresh_tokens
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_password_reset_tokens_user_id_ins
BEFORE INSERT ON password_reset_tokens
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_email_verification_tokens_user_id_ins
BEFORE INSERT ON email_verification_tokens
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_user_auth_providers_user_id_ins
BEFORE INSERT ON user_auth_providers
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_user_credentials_user_id_ins
BEFORE INSERT ON user_credentials
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS trg_reject_deleted_user_user_contacts_user_id_ins
BEFORE INSERT ON user_contacts
WHEN NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
