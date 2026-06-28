-- Prevent new account-owned rows from being attached to a soft-deleted user.
-- Account deletion takes table locks before setting users.deleted_at; these
-- guards reject blocked/new inserts once the deletion transaction commits.

CREATE OR REPLACE FUNCTION reject_deleted_user_reference()
RETURNS trigger AS $$
DECLARE
  referenced_user_id TEXT;
BEGIN
  referenced_user_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF referenced_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM users WHERE id = referenced_user_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reject_deleted_user_story_sessions_user_id_ins ON story_sessions;
CREATE TRIGGER trg_reject_deleted_user_story_sessions_user_id_ins BEFORE INSERT ON story_sessions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_tracks_user_id_ins ON tracks;
CREATE TRIGGER trg_reject_deleted_user_tracks_user_id_ins BEFORE INSERT ON tracks FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_poems_user_id_ins ON poems;
CREATE TRIGGER trg_reject_deleted_user_poems_user_id_ins BEFORE INSERT ON poems FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_share_tokens_creator_id_ins ON share_tokens;
CREATE TRIGGER trg_reject_deleted_user_share_tokens_creator_id_ins BEFORE INSERT ON share_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('creator_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_share_tokens_bound_user_id_ins ON share_tokens;
CREATE TRIGGER trg_reject_deleted_user_share_tokens_bound_user_id_ins BEFORE INSERT ON share_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('bound_user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_poem_share_tokens_creator_id_ins ON poem_share_tokens;
CREATE TRIGGER trg_reject_deleted_user_poem_share_tokens_creator_id_ins BEFORE INSERT ON poem_share_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('creator_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_poem_share_tokens_bound_user_id_ins ON poem_share_tokens;
CREATE TRIGGER trg_reject_deleted_user_poem_share_tokens_bound_user_id_ins BEFORE INSERT ON poem_share_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('bound_user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_track_library_entries_user_id_ins ON track_library_entries;
CREATE TRIGGER trg_reject_deleted_user_track_library_entries_user_id_ins BEFORE INSERT ON track_library_entries FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_poem_library_entries_user_id_ins ON poem_library_entries;
CREATE TRIGGER trg_reject_deleted_user_poem_library_entries_user_id_ins BEFORE INSERT ON poem_library_entries FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_gift_orders_sender_user_id_ins ON gift_orders;
CREATE TRIGGER trg_reject_deleted_user_gift_orders_sender_user_id_ins BEFORE INSERT ON gift_orders FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('sender_user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_gift_reservations_user_id_ins ON gift_reservations;
CREATE TRIGGER trg_reject_deleted_user_gift_reservations_user_id_ins BEFORE INSERT ON gift_reservations FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_gift_wallet_user_id_ins ON gift_wallet;
CREATE TRIGGER trg_reject_deleted_user_gift_wallet_user_id_ins BEFORE INSERT ON gift_wallet FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_gift_wallet_transactions_user_id_ins ON gift_wallet_transactions;
CREATE TRIGGER trg_reject_deleted_user_gift_wallet_transactions_user_id_ins BEFORE INSERT ON gift_wallet_transactions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_credit_transactions_user_id_ins ON credit_transactions;
CREATE TRIGGER trg_reject_deleted_user_credit_transactions_user_id_ins BEFORE INSERT ON credit_transactions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_song_transactions_user_id_ins ON song_transactions;
CREATE TRIGGER trg_reject_deleted_user_song_transactions_user_id_ins BEFORE INSERT ON song_transactions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_purchase_receipts_user_id_ins ON purchase_receipts;
CREATE TRIGGER trg_reject_deleted_user_purchase_receipts_user_id_ins BEFORE INSERT ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_subscriptions_user_id_ins ON subscriptions;
CREATE TRIGGER trg_reject_deleted_user_subscriptions_user_id_ins BEFORE INSERT ON subscriptions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_webhook_notifications_user_id_ins ON webhook_notifications;
CREATE TRIGGER trg_reject_deleted_user_webhook_notifications_user_id_ins BEFORE INSERT ON webhook_notifications FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_entitlements_user_id_ins ON entitlements;
CREATE TRIGGER trg_reject_deleted_user_entitlements_user_id_ins BEFORE INSERT ON entitlements FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_devices_user_id_ins ON devices;
CREATE TRIGGER trg_reject_deleted_user_devices_user_id_ins BEFORE INSERT ON devices FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_apple_ads_attribution_user_id_ins ON apple_ads_attribution;
CREATE TRIGGER trg_reject_deleted_user_apple_ads_attribution_user_id_ins BEFORE INSERT ON apple_ads_attribution FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_download_events_matched_user_id_ins ON download_events;
CREATE TRIGGER trg_reject_deleted_user_download_events_matched_user_id_ins BEFORE INSERT ON download_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('matched_user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_events_user_id_ins ON events;
CREATE TRIGGER trg_reject_deleted_user_events_user_id_ins BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_receiver_sessions_matched_user_id_ins ON receiver_sessions;
CREATE TRIGGER trg_reject_deleted_user_receiver_sessions_matched_user_id_ins BEFORE INSERT ON receiver_sessions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('matched_user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_enrollment_sessions_user_id_ins ON enrollment_sessions;
CREATE TRIGGER trg_reject_deleted_user_enrollment_sessions_user_id_ins BEFORE INSERT ON enrollment_sessions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_voice_profiles_user_id_ins ON voice_profiles;
CREATE TRIGGER trg_reject_deleted_user_voice_profiles_user_id_ins BEFORE INSERT ON voice_profiles FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_voice_provider_profiles_user_id_ins ON voice_provider_profiles;
CREATE TRIGGER trg_reject_deleted_user_voice_provider_profiles_user_id_ins BEFORE INSERT ON voice_provider_profiles FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_voice_provider_jobs_user_id_ins ON voice_provider_jobs;
CREATE TRIGGER trg_reject_deleted_user_voice_provider_jobs_user_id_ins BEFORE INSERT ON voice_provider_jobs FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_rate_limits_user_id_ins ON rate_limits;
CREATE TRIGGER trg_reject_deleted_user_rate_limits_user_id_ins BEFORE INSERT ON rate_limits FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_user_sessions_user_id_ins ON user_sessions;
CREATE TRIGGER trg_reject_deleted_user_user_sessions_user_id_ins BEFORE INSERT ON user_sessions FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_token_families_user_id_ins ON token_families;
CREATE TRIGGER trg_reject_deleted_user_token_families_user_id_ins BEFORE INSERT ON token_families FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_refresh_tokens_user_id_ins ON refresh_tokens;
CREATE TRIGGER trg_reject_deleted_user_refresh_tokens_user_id_ins BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_password_reset_tokens_user_id_ins ON password_reset_tokens;
CREATE TRIGGER trg_reject_deleted_user_password_reset_tokens_user_id_ins BEFORE INSERT ON password_reset_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_email_verification_tokens_user_id_ins ON email_verification_tokens;
CREATE TRIGGER trg_reject_deleted_user_email_verification_tokens_user_id_ins BEFORE INSERT ON email_verification_tokens FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_user_auth_providers_user_id_ins ON user_auth_providers;
CREATE TRIGGER trg_reject_deleted_user_user_auth_providers_user_id_ins BEFORE INSERT ON user_auth_providers FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_user_credentials_user_id_ins ON user_credentials;
CREATE TRIGGER trg_reject_deleted_user_user_credentials_user_id_ins BEFORE INSERT ON user_credentials FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
DROP TRIGGER IF EXISTS trg_reject_deleted_user_user_contacts_user_id_ins ON user_contacts;
CREATE TRIGGER trg_reject_deleted_user_user_contacts_user_id_ins BEFORE INSERT ON user_contacts FOR EACH ROW EXECUTE FUNCTION reject_deleted_user_reference('user_id');
