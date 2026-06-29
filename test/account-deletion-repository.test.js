process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAccountDeletionRepository,
} = require("../src/database/account-deletion-repository");
const { identityHash } = require("../src/services/identity-service");

let db;
let repository;

const NOW = "2026-06-26T10:00:00.000Z";

async function seedUser({
  userId,
  email = `${userId}@example.com`,
  phoneNumber = "+15555550123",
} = {}) {
  await db
    .prepare(
      `INSERT INTO users (
        id, email, email_verified, display_name, avatar_url, phone_number,
        phone_verified_at, username, risk_level, locale, country,
        acquisition_source, acquisition_campaign, acquisition_country,
        acquisition_medium, acquisition_content, acquisition_term,
        acquisition_referrer, acquisition_at, onesignal_synced_at,
        profile_completion_skipped_at, unsubscribed_at, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'low', 'en-US', 'US',
        'apple_ads', 'spring', 'US', 'cpc', 'creative', 'keyword',
        'https://example.com', ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      email,
      "Target User",
      "https://avatar.example.com/user.png",
      phoneNumber,
      NOW,
      `${userId}_name`,
      NOW,
      NOW,
      NOW,
      NOW,
      NOW,
    );
}

async function tableCount(table, whereSql = "1 = 1", params = []) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${whereSql}`)
    .get(...params);
  return Number(row.count);
}

describe("AccountDeletionRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAccountDeletionRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("captures deletion tombstone context and writes distinct signup/trial tombstones", async () => {
    await seedUser({ userId: "user_account_delete_tombstone" });
    await db
      .prepare(
        `INSERT INTO user_auth_providers (
          id, user_id, provider, provider_user_id, provider_data,
          verified_at, linked_at, last_used_at, status
        ) VALUES (?, ?, 'google', ?, '{}', ?, ?, ?, 'active')`,
      )
      .run(
        "ap_account_delete_tombstone",
        "user_account_delete_tombstone",
        "google-subject",
        NOW,
        NOW,
        NOW,
      );
    await db
      .prepare(
        `INSERT INTO entitlements (user_id, tier, updated_at, trial_started_at)
         VALUES (?, 'free', ?, ?)`,
      )
      .run("user_account_delete_tombstone", NOW, NOW);

    const context = await repository.getDeletionTombstoneContext(
      "user_account_delete_tombstone",
    );
    assert.deepEqual(context, {
      providers: [{ provider: "google", provider_user_id: "google-subject" }],
      hadTrial: true,
    });

    const hash = identityHash("google", "google-subject");
    await repository.insertGrantedIdentityTombstones({
      identityHashes: [hash],
      hadTrial: true,
    });
    await repository.insertGrantedIdentityTombstones({
      identityHashes: [hash],
      hadTrial: true,
    });

    const rows = await db
      .prepare(
        "SELECT identity_hash, grant_kind FROM granted_identities WHERE identity_hash = ? ORDER BY grant_kind",
      )
      .all(hash);
    assert.deepEqual(rows, [
      { identity_hash: hash, grant_kind: "signup" },
      { identity_hash: hash, grant_kind: "trial" },
    ]);
  });

  test("deletes account-owned rows and scrubs retained account evidence atomically", async () => {
    const userId = "user_account_delete_repo";
    const otherUserId = "user_account_delete_other";
    await seedUser({ userId });
    await seedUser({
      userId: otherUserId,
      email: "other-account-delete@example.com",
      phoneNumber: "+15555550124",
    });

    await db
      .prepare(
        "INSERT INTO tracks (id, user_id, status, title, created_at, updated_at) VALUES (?, ?, 'ready', 'Song', ?, ?)",
      )
      .run("track_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, 1, 'ready', 'preview', 'hash', ?)",
      )
      .run("tv_delete_repo", "track_delete_repo", NOW);
    await db
      .prepare(
        "INSERT INTO jobs (id, track_version_id, workflow_type, status, created_at, updated_at) VALUES (?, ?, 'render', 'pending', ?, ?)",
      )
      .run("job_delete_repo", "tv_delete_repo", NOW, NOW);
    await db
      .prepare(
        `INSERT INTO share_tokens (
          id, track_id, track_version_id, creator_id, status,
          web_stream_allowed, app_save_allowed, expires_at, created_at, access_count
        ) VALUES (?, ?, ?, ?, 'unbound', 1, 1, ?, ?, 0)`,
      )
      .run("share_delete_repo", "track_delete_repo", "tv_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO share_access_log (id, share_token_id, event_type, metadata, created_at) VALUES (?, ?, 'view', '{}', ?)",
      )
      .run("sal_delete_repo", "share_delete_repo", NOW);
    await db
      .prepare(
        "INSERT INTO track_library_entries (user_id, track_id, origin, added_at, updated_at) VALUES (?, ?, 'created', ?, ?)",
      )
      .run(userId, "track_delete_repo", NOW, NOW);

    await db
      .prepare(
        "INSERT INTO tracks (id, user_id, status, title, created_at, updated_at) VALUES (?, ?, 'ready', 'Other Song', ?, ?)",
      )
      .run("track_delete_other", otherUserId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, 1, 'ready', 'preview', 'other_hash', ?)",
      )
      .run("tv_delete_other", "track_delete_other", NOW);
    await db
      .prepare(
        `INSERT INTO share_tokens (
          id, track_id, track_version_id, creator_id, status, bound_user_id,
          bound_device_id, bound_device_platform, bound_app_version, bound_at,
          web_stream_allowed, app_save_allowed, expires_at, created_at, access_count
        ) VALUES (?, ?, ?, ?, 'claimed', ?, 'device_secret', 'ios', '1.0', ?, 1, 1, ?, ?, 0)`,
      )
      .run(
        "share_delete_other_bound",
        "track_delete_other",
        "tv_delete_other",
        otherUserId,
        userId,
        NOW,
        NOW,
        NOW,
      );
    await db
      .prepare(
        "INSERT INTO share_access_log (id, share_token_id, event_type, metadata, created_at) VALUES (?, ?, 'view', ?, ?)",
      )
      .run(
        "sal_delete_other_bound",
        "share_delete_other_bound",
        JSON.stringify({ user_agent: "recipient ua", ip: "203.0.113.51" }),
        NOW,
      );

    await db
      .prepare(
        `INSERT INTO poems (
          id, user_id, title, recipient_name, occasion, tone, verses, status,
          created_at, updated_at
        ) VALUES (?, ?, 'Poem', 'Ava', 'Birthday', 'heartfelt', '[]', 'ready', ?, ?)`,
      )
      .run("poem_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO poem_share_tokens (id, poem_id, creator_id, status, bound_user_id, bound_at, expires_at, created_at) VALUES (?, ?, ?, 'claimed', ?, ?, ?, ?)",
      )
      .run("poem_share_delete_repo", "poem_delete_repo", userId, userId, NOW, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, 'view', '{}', ?)",
      )
      .run("psal_delete_repo", "poem_share_delete_repo", NOW);
    await db
      .prepare(
        "INSERT INTO poem_library_entries (user_id, poem_id, origin, added_at, updated_at) VALUES (?, ?, 'created', ?, ?)",
      )
      .run(userId, "poem_delete_repo", NOW, NOW);
    await db
      .prepare(
        `INSERT INTO poems (
          id, user_id, title, recipient_name, occasion, tone, verses, status,
          created_at, updated_at
        ) VALUES (?, ?, 'Other Poem', 'Ava', 'Birthday', 'heartfelt', '[]', 'ready', ?, ?)`,
      )
      .run("poem_delete_other", otherUserId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO poem_share_tokens (id, poem_id, creator_id, status, bound_user_id, bound_at, expires_at, created_at) VALUES (?, ?, ?, 'claimed', ?, ?, ?, ?)",
      )
      .run(
        "poem_share_delete_other_bound",
        "poem_delete_other",
        otherUserId,
        userId,
        NOW,
        NOW,
        NOW,
      );
    await db
      .prepare(
        "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, 'view', ?, ?)",
      )
      .run(
        "psal_delete_other_bound",
        "poem_share_delete_other_bound",
        JSON.stringify({ user_agent: "recipient ua", ip: "203.0.113.52" }),
        NOW,
      );

    await db
      .prepare(
        `INSERT INTO gift_orders (
          id, sender_user_id, content_type, content_id, status, dispatch_status,
          delivery_mode, send_at, sender_timezone, channels_json, recipient_email,
          recipient_phone, message, claim_policy, expires_in_days, dispatch_attempts,
          created_at, updated_at
        ) VALUES (?, ?, 'song', ?, 'scheduled', 'pending', 'scheduled', ?, 'UTC',
          '["email"]', 'recipient@example.com', '+15555559999', 'PII message',
          'app_only', 30, 0, ?, ?)`,
      )
      .run("gift_delete_repo", userId, "track_delete_repo", NOW, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO gift_delivery_outbox (id, gift_order_id, channel, recipient, send_after, payload_json, created_at, updated_at) VALUES (?, ?, 'email', 'recipient@example.com', ?, '{\"pii\":true}', ?, ?)",
      )
      .run("gdo_delete_repo", "gift_delete_repo", NOW, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO gift_dispatch_attempts (id, gift_order_id, channel, status, payload_json, created_at) VALUES (?, ?, 'email', 'failed', '{\"pii\":true}', ?)",
      )
      .run("gda_delete_repo", "gift_delete_repo", NOW);
    await db
      .prepare(
        "INSERT INTO gift_delivery_incidents (id, incident_key, incident_type, severity, status, gift_order_id, summary, detail, created_at, updated_at) VALUES (?, ?, 'delivery_failed', 'high', 'open', ?, 'PII', 'PII detail', ?, ?)",
      )
      .run("gdi_delete_repo", "gdi_delete_repo_key", "gift_delete_repo", NOW, NOW);
    await db
      .prepare(
        "INSERT INTO gift_reservations (id, user_id, status, token_transaction_id, expires_at, created_at, updated_at) VALUES (?, ?, 'reserved', 'gift_tx', ?, ?, ?)",
      )
      .run("gres_delete_repo", userId, NOW, NOW, NOW);
    await db
      .prepare("INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 1, ?)")
      .run(userId, NOW);
    await db
      .prepare(
        "INSERT INTO gift_wallet_transactions (id, user_id, type, amount, balance_before, balance_after, created_at) VALUES (?, ?, 'purchase', 1, 0, 1, ?)",
      )
      .run("gwt_delete_repo", userId, NOW);

    await db
      .prepare(
        "INSERT INTO credit_transactions (id, user_id, type, amount, balance_before, balance_after, created_at) VALUES (?, ?, 'spend', -1, 1, 0, ?)",
      )
      .run("ct_delete_repo", userId, NOW);
    await db
      .prepare(
        "INSERT INTO song_transactions (id, user_id, type, amount, balance_before, balance_after, created_at) VALUES (?, ?, 'song_spend', -1, 1, 0, ?)",
      )
      .run("st_delete_repo", userId, NOW);
    await db
      .prepare(
        `INSERT INTO purchase_receipts (
          id, user_id, transaction_id, original_transaction_id, product_id,
          platform, verification_status, purchase_date, created_at
        ) VALUES (?, ?, 'tx_delete_repo', 'otx_delete_repo', 'product', 'ios', 'verified', ?, ?)`,
      )
      .run("pr_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO subscriptions (id, user_id, product_id, tier, platform, created_at, updated_at) VALUES (?, ?, 'product', 'plus', 'ios', ?, ?)",
      )
      .run("sub_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO webhook_notifications (id, platform, notification_type, notification_uuid, user_id, payload_json, processed_at, created_at) VALUES (?, 'ios', 'renewal', 'wn_delete_repo', ?, '{\"pii\":true}', ?, ?)",
      )
      .run("wn_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO entitlements (user_id, tier, updated_at, trial_started_at) VALUES (?, 'free', ?, ?)",
      )
      .run(userId, NOW, NOW);

    await db
      .prepare(
        "INSERT INTO devices (id, user_id, device_id, platform, push_token, created_at, updated_at) VALUES (?, ?, 'device-secret', 'ios', 'push-secret', ?, ?)",
      )
      .run("dev_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO apple_ads_attribution (id, user_id, attribution_token_sha256, token_length, created_at, updated_at) VALUES (?, ?, 'token_hash_delete_repo', 64, ?, ?)",
      )
      .run("aaa_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO download_events (id, ip_address, user_agent, matched_user_id) VALUES (?, '203.0.113.9', 'ua', ?)",
      )
      .run("download_delete_repo", userId);
    await db
      .prepare(
        "INSERT INTO events (id, event_name, user_id, ip_address, user_agent, created_at) VALUES (?, 'test_event', ?, '203.0.113.10', 'ua', ?)",
      )
      .run("event_delete_repo", userId, NOW);
    await db
      .prepare(
        `INSERT INTO receiver_sessions (
          id, share_id, content_kind, receiver_handoff_id,
          receiver_session_secret_hash, receiver_claim_token_hash,
          claim_token_expires_at, first_event_name, last_event_name,
          first_ip_address, last_ip_address, first_user_agent, last_user_agent,
          appsflyer_click_id, matched_user_id, created_at, updated_at
        ) VALUES (?, ?, 'song', ?, 'secret_hash', 'claim_hash', ?, 'view',
          'claim', '203.0.113.12', '203.0.113.13', 'first ua', 'last ua',
          'af-secret', ?, ?, ?)`,
      )
      .run(
        "receiver_session_delete_repo",
        "share_delete_other_bound",
        "handoff_delete_repo",
        NOW,
        userId,
        NOW,
        NOW,
      );
    await db
      .prepare(
        "INSERT INTO receiver_claim_tokens (token_hash, receiver_session_id, share_id, content_kind, expires_at, created_at) VALUES (?, ?, ?, 'song', ?, ?)",
      )
      .run(
        "receiver_claim_delete_repo",
        "receiver_session_delete_repo",
        "share_delete_other_bound",
        NOW,
        NOW,
      );
    await db
      .prepare(
        "INSERT INTO receiver_session_events (id, receiver_session_id, share_id, event_name, metadata_json, ip_address, user_agent, created_at) VALUES (?, ?, ?, 'claim', ?, '203.0.113.14', 'event ua', ?)",
      )
      .run(
        "receiver_event_delete_repo",
        "receiver_session_delete_repo",
        "share_delete_other_bound",
        JSON.stringify({ matched_user_id: userId, ip: "203.0.113.14" }),
        NOW,
      );

    await db
      .prepare(
        "INSERT INTO auth_events (id, user_id, event_type, ip_address, user_agent, metadata, created_at) VALUES (?, ?, 'login_success', '203.0.113.11', 'ua', ?, ?)",
      )
      .run(
        "auth_event_delete_repo",
        userId,
        JSON.stringify({ provider_user_id: "secret-provider-id" }),
        NOW,
      );
    await db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, 'PREEXISTING_AUDIT', 'user', ?, ?, ?)",
      )
      .run(
        "audit_delete_repo",
        userId,
        userId,
        JSON.stringify({ ip: "203.0.113.15", email: "delete@example.com" }),
        NOW,
      );
    await db
      .prepare("INSERT INTO user_sessions (id, user_id, created_at) VALUES (?, ?, ?)")
      .run("session_delete_repo", userId, NOW);
    await db
      .prepare("INSERT INTO token_families (id, user_id, session_id, created_at) VALUES (?, ?, ?, ?)")
      .run("family_delete_repo", userId, "session_delete_repo", NOW);
    await db
      .prepare(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, token_family, expires_at, created_at) VALUES (?, ?, 'refresh_hash_delete_repo', ?, ?, ?)",
      )
      .run("refresh_delete_repo", userId, "family_delete_repo", NOW, NOW);
    await db
      .prepare(
        "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, 'reset_hash_delete_repo', ?, ?)",
      )
      .run("reset_delete_repo", userId, NOW, NOW);
    await db
      .prepare(
        "INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, 'verify_hash_delete_repo', ?, ?)",
      )
      .run("verify_delete_repo", userId, NOW, NOW);
    await db
      .prepare("INSERT INTO user_credentials (user_id, password_hash, created_at) VALUES (?, 'hash', ?)")
      .run(userId, NOW);
    await db
      .prepare(
        `INSERT INTO user_auth_providers (
          id, user_id, provider, provider_user_id, provider_data,
          verified_at, linked_at, last_used_at, status
        ) VALUES (?, ?, 'email', ?, '{}', ?, ?, ?, 'active')`,
      )
      .run("ap_delete_repo", userId, "delete@example.com", NOW, NOW, NOW);
    await db
      .prepare(
        `INSERT INTO user_contacts (
          id, user_id, type, value_normalized, value_display, source,
          is_primary, is_relay, created_at
        ) VALUES (?, ?, 'email', 'delete@example.com', 'delete@example.com',
          'test', 1, 0, ?)`,
      )
      .run("uc_delete_repo", userId, NOW);
    await db
      .prepare(
        `INSERT INTO rate_limits (
          user_id, action_type, window_start_ms, window_seconds, count, limit_count
        ) VALUES (?, 'delete_account', 1, 60, 1, 3)`,
      )
      .run(userId);

    await repository.transaction(async (txRepository) => {
      await txRepository.deleteShareRowsForUser(userId);
      await txRepository.deleteTrackRowsForUser(userId);
      await txRepository.deletePoemRowsForUser(userId);
      await txRepository.deleteGiftRowsForUser(userId);
      await txRepository.deleteBillingRowsForUser(userId);
      await txRepository.deleteRateLimitRowsForUser(userId);
      await txRepository.scrubTelemetryAndAttributionRowsForUser(userId);
      await txRepository.anonymizeAuthEventsForUser(userId);
      await txRepository.anonymizeAuditLogsForUser(userId);
      await txRepository.deleteAuthTokenAndSessionRowsForUser(userId);
      await txRepository.deleteAuthProviderAndCredentialRowsForUser(userId);
      await txRepository.deleteContactRowsForUser(userId);
      await txRepository.softDeleteUser({ userId, deletedAt: NOW });
      await txRepository.insertAccountDeletedAuthEvent({
        id: "auth_event_deleted_repo",
        userId,
      });
    });

    for (const [table, whereSql, params] of [
      ["share_tokens", "id = ?", ["share_delete_repo"]],
      ["share_access_log", "share_token_id = ?", ["share_delete_repo"]],
      ["share_access_log", "id = ?", ["sal_delete_other_bound"]],
      ["track_library_entries", "user_id = ? OR track_id = ?", [userId, "track_delete_repo"]],
      ["jobs", "id = ?", ["job_delete_repo"]],
      ["track_versions", "id = ?", ["tv_delete_repo"]],
      ["tracks", "id = ?", ["track_delete_repo"]],
      ["poem_share_tokens", "id = ?", ["poem_share_delete_repo"]],
      ["poem_share_access_log", "poem_share_token_id = ?", ["poem_share_delete_repo"]],
      ["poem_share_access_log", "id = ?", ["psal_delete_other_bound"]],
      ["poem_library_entries", "user_id = ? OR poem_id = ?", [userId, "poem_delete_repo"]],
      ["poems", "id = ?", ["poem_delete_repo"]],
      ["gift_delivery_outbox", "gift_order_id = ?", ["gift_delete_repo"]],
      ["gift_dispatch_attempts", "gift_order_id = ?", ["gift_delete_repo"]],
      ["gift_delivery_incidents", "gift_order_id = ?", ["gift_delete_repo"]],
      ["gift_orders", "id = ?", ["gift_delete_repo"]],
      ["gift_reservations", "user_id = ?", [userId]],
      ["gift_wallet_transactions", "user_id = ?", [userId]],
      ["gift_wallet", "user_id = ?", [userId]],
      ["credit_transactions", "user_id = ?", [userId]],
      ["song_transactions", "user_id = ?", [userId]],
      ["purchase_receipts", "user_id = ?", [userId]],
      ["subscriptions", "user_id = ?", [userId]],
      ["webhook_notifications", "user_id = ?", [userId]],
      ["entitlements", "user_id = ?", [userId]],
      ["devices", "user_id = ?", [userId]],
      ["apple_ads_attribution", "user_id = ?", [userId]],
      ["download_events", "matched_user_id = ?", [userId]],
      ["receiver_claim_tokens", "receiver_session_id = ?", ["receiver_session_delete_repo"]],
      ["rate_limits", "user_id = ?", [userId]],
      ["refresh_tokens", "user_id = ?", [userId]],
      ["token_families", "user_id = ?", [userId]],
      ["user_sessions", "user_id = ?", [userId]],
      ["password_reset_tokens", "user_id = ?", [userId]],
      ["email_verification_tokens", "user_id = ?", [userId]],
      ["user_auth_providers", "user_id = ?", [userId]],
      ["user_credentials", "user_id = ?", [userId]],
      ["user_contacts", "user_id = ?", [userId]],
    ]) {
      assert.equal(await tableCount(table, whereSql, params), 0, `${table} rows`);
    }

    const retainedShare = await db
      .prepare(
        "SELECT status, bound_user_id, bound_device_id, bound_device_platform, bound_app_version, bound_at FROM share_tokens WHERE id = ?",
      )
      .get("share_delete_other_bound");
    assert.deepEqual(retainedShare, {
      status: "claimed",
      bound_user_id: null,
      bound_device_id: null,
      bound_device_platform: null,
      bound_app_version: null,
      bound_at: null,
    });

    const retainedPoemShare = await db
      .prepare(
        "SELECT status, bound_user_id, bound_at FROM poem_share_tokens WHERE id = ?",
      )
      .get("poem_share_delete_other_bound");
    assert.deepEqual(retainedPoemShare, {
      status: "claimed",
      bound_user_id: null,
      bound_at: null,
    });

    const telemetry = await db
      .prepare("SELECT user_id, ip_address, user_agent FROM events WHERE id = ?")
      .get("event_delete_repo");
    assert.deepEqual(telemetry, {
      user_id: null,
      ip_address: null,
      user_agent: null,
    });

    const receiverSession = await db
      .prepare(
        `SELECT receiver_session_secret_hash, receiver_claim_token_hash,
          claim_token_expires_at, first_ip_address, last_ip_address,
          first_user_agent, last_user_agent, appsflyer_click_id, matched_user_id
         FROM receiver_sessions WHERE id = ?`,
      )
      .get("receiver_session_delete_repo");
    assert.deepEqual(receiverSession, {
      receiver_session_secret_hash: null,
      receiver_claim_token_hash: null,
      claim_token_expires_at: null,
      first_ip_address: null,
      last_ip_address: null,
      first_user_agent: null,
      last_user_agent: null,
      appsflyer_click_id: null,
      matched_user_id: null,
    });
    const receiverEvent = await db
      .prepare(
        "SELECT metadata_json, ip_address, user_agent FROM receiver_session_events WHERE id = ?",
      )
      .get("receiver_event_delete_repo");
    assert.deepEqual(receiverEvent, {
      metadata_json: null,
      ip_address: null,
      user_agent: null,
    });

    const authEvents = await db
      .prepare(
        "SELECT event_type, ip_address, user_agent, metadata FROM auth_events WHERE user_id = ? ORDER BY event_type",
      )
      .all(userId);
    assert.deepEqual(authEvents, [
      {
        event_type: "account_deleted",
        ip_address: null,
        user_agent: null,
        metadata: null,
      },
      {
        event_type: "login_success",
        ip_address: null,
        user_agent: null,
        metadata: null,
      },
    ]);
    const auditLog = await db
      .prepare("SELECT resource_id, metadata_json FROM audit_logs WHERE id = ?")
      .get("audit_delete_repo");
    assert.deepEqual(auditLog, {
      resource_id: null,
      metadata_json: null,
    });

    const user = await db
      .prepare(
        `SELECT email, email_verified, display_name, avatar_url, phone_number,
          phone_verified_at, username, locale, country, acquisition_source,
          acquisition_campaign, acquisition_country, acquisition_medium,
          acquisition_content, acquisition_term, acquisition_referrer,
          acquisition_at, onesignal_synced_at, profile_completion_skipped_at,
          unsubscribed_at, deleted_at
         FROM users WHERE id = ?`,
      )
      .get(userId);
    assert.deepEqual(user, {
      email: `deleted_${userId}@deleted.local`,
      email_verified: 0,
      display_name: "Deleted User",
      avatar_url: null,
      phone_number: null,
      phone_verified_at: null,
      username: null,
      locale: null,
      country: null,
      acquisition_source: null,
      acquisition_campaign: null,
      acquisition_country: null,
      acquisition_medium: null,
      acquisition_content: null,
      acquisition_term: null,
      acquisition_referrer: null,
      acquisition_at: null,
      onesignal_synced_at: null,
      profile_completion_skipped_at: null,
      unsubscribed_at: null,
      deleted_at: NOW,
    });

    assert.equal(
      await tableCount("tracks", "id = ?", ["track_delete_other"]),
      1,
      "other user's track survives",
    );
    assert.equal(
      await tableCount("poems", "id = ?", ["poem_delete_other"]),
      1,
      "other user's poem survives",
    );
  });

  test("deleted-user write guard rejects new direct account rows", async () => {
    const userId = "user_account_delete_guard";
    await seedUser({ userId });
    await repository.softDeleteUser({ userId, deletedAt: NOW });

    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO tracks (id, user_id, status, title, created_at, updated_at) VALUES (?, ?, 'ready', 'Late Song', ?, ?)",
          )
          .run("track_after_delete_guard", userId, NOW, NOW),
      /ACCOUNT_DELETED/,
    );
  });
});
