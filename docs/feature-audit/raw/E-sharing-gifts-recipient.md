# Feature Audit — Sharing / Gifts / Recipient-Receiver / Notifications

**Auditor:** Claude Code (claude-sonnet-4-6)
**Date:** 2026-06-22
**Branch:** feat/binding-app-only-recipient-first
**Scope:** Backend Node.js + Fastify (Postgres). Feature-discovery only — no code modified.

---

## Table of Contents

1. Create Share Link (Lifetime Token)
2. Device-Binding / First-to-Claim
3. Receiver Session / Claim Flow
4. Recipient Deep-Link / App-Wall Handoff
5. ReceiverHandoffId Persistence (download → login → claim)
6. SMS Gift Delivery (Twilio)
7. Email Gift Delivery (Resend)
8. Push Notifications — Transactional (APNs)
9. Push Notifications — Marketing (OneSignal)
10. Share Access Logging
11. Share Follow-Ups
12. Gift Funding (Wallet, Reservations, Billing)
13. OG Image / Meta for Share Page
14. Viral Loop / Events Tracking
15. App-Wall / Browser Detection
16. Recipient Contact Storage
17. Gift Ops Monitoring
18. Stream Key / Audio Access
19. Share Token Revocation / Expiry
20. Rate Limiting on Share Endpoints
21. Signed-Out Claim Flow
22. Gift Delivery Outbox / Retry Infrastructure
23. Gift Order Scheduling
24. Poem Share Binding
25. Audiogram Download

---

### 1. Create Share Link (Lifetime Token)

**user_story:** As a sender, I want to create a permanent share link for a song or poem so that the recipient can access it indefinitely.

**expected_behavior:**

- Endpoint: `POST /tracks/:id/share` (songs), `POST /poems/:id/share` (poems)
- Calls `createOrReuseShareToken(db, { trackId, userId, requirePin, shareType })` in `share-service.js`
- Token ID generated with `newShareId()`, expiry set to `LIFETIME_SHARE_EXPIRES_AT` = `9999-12-31T23:59:59.000Z`
- `share_type = 'lifetime'` inserted into `share_tokens`
- `stream_key_id` (UUID) and `stream_key` (16 random bytes as base64) generated and stored
- `status = 'unbound'` on creation
- `web_stream_allowed`, `app_save_allowed` flags set
- `claim_policy`, `delivery_source`, `dispatch_at`, `dispatched_at` added by migration 056
- Before creating: deletes any existing `expired` or `revoked` tokens for the same `track_id`
- Before creating: checks for existing usable share (`isShareUsable`) and returns it if valid, with PIN nulled out if `requirePin === false` and token is still `unbound`
- Response: `{ shareId, shareUrl, claimPin, expiresAt, existing }`
- Share URL constructed by `buildShareUrl(shareId)` — `${publicBaseUrl}/share/${shareId}`
- Poem shares stored in `poem_share_tokens` with identical fields
- `track.share_token_id` FK updated on the tracks row

**status:** implemented
**evidence:**

- `src/services/share-service.js` lines 1–150 — full `createOrReuseShareToken` implementation verified
- `src/routes/sharing.js` — endpoints confirmed via grep
- `migrations/pg/056_gift_scheduling_and_wallet.sql` — delivery metadata columns
- `migrations/pg/001_init.sql` — base `share_tokens` table

**gaps:**

- No idempotency key on the `POST /tracks/:id/share` endpoint — concurrent requests from the same user can race past the `isShareUsable` check and create two tokens (the DELETE of stale tokens is not atomic with the INSERT)
- `isShareUsable` checks `status IN ('unbound', 'claimed')` but does not verify `track_version_id` is still the latest — share can point to an outdated render version after a re-roll without expiring
- No caller-visible signal when returning `existing: true` with a mutated PIN (claim_pin set to NULL) — iOS client may cache the old PIN

**key_files:** `src/services/share-service.js`, `src/routes/sharing.js`
**db_tables:** `share_tokens`, `poem_share_tokens`, `tracks`

---

### 2. Device-Binding / First-to-Claim

**user_story:** As a recipient, I want to permanently bind a share link to my device/account so that no one else can claim it after I do.

**expected_behavior:**

- Endpoint: `POST /share/:shareId/claim`
- Pre-claim checks in JS (not atomic):
  1. If `share.bound_device_id` is set AND differs from incoming `deviceId` → 409 `TOKEN_ALREADY_BOUND`
  2. If `share.bound_user_id` is set AND differs from incoming `claimUserId` → 409 `TOKEN_ALREADY_BOUND`
- Atomic UPDATE (the real guard):
  ```sql
  UPDATE share_tokens
  SET status = 'claimed', bound_device_id = ?, bound_device_platform = ?, bound_app_version = ?,
      bound_user_id = COALESCE(?, bound_user_id), bound_at = ?, web_stream_allowed = ?, claim_attempts = 0
  WHERE id = ? AND bound_device_id IS NULL AND status = 'unbound'
  ```
- If `claimResult.changes === 0` → concurrent claim detected → 409 `TOKEN_ALREADY_BOUND` + log `[SecurityGuard:ClaimRace]`
- On success: `upsertTrackLibraryEntry` with `origin: 'received'`
- Share access log event: `claim_success` or `claim_failed` with reason
- `bound_device_platform`, `bound_app_version` stored
- `web_stream_allowed` preserved from share token at claim time
- `bound_user_id` can be NULL at claim time (anonymous device claim) and filled in later via `COALESCE`

**status:** implemented
**evidence:**

- `src/routes/sharing.js` line ~2094–2240 — full claim logic confirmed
- Atomic WHERE guard confirmed: `AND bound_device_id IS NULL AND status = 'unbound'`
- Concurrent claim fallback log string confirmed: `[SecurityGuard:ClaimRace]`

**gaps:**

- `bound_user_id` bind is soft: `COALESCE(?, bound_user_id)` means if `claimUserId` is NULL the original user_id is preserved — a signed-out claim can silently inherit a prior user's binding
- No re-bind endpoint for legitimate device transfer (e.g. user gets new phone) — once bound, the song is locked to the original device forever unless admin intervenes
- `claim_attempts` counter is reset to 0 on success but there is no increment on failed attempts before the atomic UPDATE fires — the JS pre-check can be bypassed by an attacker who always sends a NULL `deviceId` (JS check only fires if `share.bound_device_id` is set AND differs)
- No claim expiry — an `unbound` lifetime token can be claimed years after creation with no time gate

**key_files:** `src/routes/sharing.js`
**db_tables:** `share_tokens`, `track_library_entries`, `share_access_log`

---

### 3. Receiver Session / Claim Flow

**user_story:** As a recipient browsing the share page, I want my session to be tracked so that my in-app claim can be attributed to my web engagement.

**expected_behavior:**

- Service: `src/services/receiver-session-service.js`
- Table: `receiver_sessions` (migration 103) with columns: `id`, `share_id`, `content_kind` (song|poem), `receiver_handoff_id`, `receiver_session_secret_hash`, `receiver_claim_token_hash`, `handoff_expires_at`, `handoff_resolved_at`, `claim_token_expires_at`, `download_attributed_at`, `first_event_name`, `last_event_name`, `first_ip_address`, `last_ip_address`, `first_user_agent`, `last_user_agent`, `appsflyer_click_id`, `matched_user_id`
- Session creation: on any web share page view; lazily created on first `recordEvent()` call
- Session secret: 32-byte random hex, stored as bcrypt hash in `receiver_session_secret_hash`
- Events stored in `receiver_session_events` (id, receiver_session_id, share_id, event_name, metadata_json, ip_address, user_agent, created_at)
- Event types confirmed in code: `receiver_play_started`, `receiver_save_cta_viewed`, `receiver_save_cta_clicked`, `receiver_app_opened`, `receiver_claim_failed`, `receiver_claim_success`
- Separate `receiver_claim_tokens` table (migration 104): `token_hash`, `receiver_session_id`, `share_id`, `content_kind`, `expires_at`, `consumed_at`
- `markAppOpened()` function records `receiver_app_opened` event with `matched_user_id`

**status:** implemented
**evidence:**

- `migrations/pg/103_receiver_sessions.sql` — full schema confirmed
- `migrations/pg/104_receiver_claim_tokens.sql` — claim token table confirmed
- `src/services/receiver-session-service.js` — `recordEvent`, `lookupHandoff`, `consumeHandoff`, `rotateReceiverHandoffIfNeeded`, `markAppOpened` functions all confirmed

**gaps:**

- Session secret is verified on subsequent calls but the initial `createIfMissing=true` path creates a session and returns the secret in plaintext — if this response is intercepted over HTTP (non-HTTPS dev), the secret leaks
- `receiver_claim_tokens` table exists but there is no confirmed code path in routes that issues or redeems a claim token — the table may be scaffolded but not wired in
- No automatic session expiry / pruning job for `receiver_sessions` rows — table can grow unboundedly
- `appsflyer_click_id` column exists but no confirmed code path populates it from the incoming OneLink deep link

**key_files:** `src/services/receiver-session-service.js`, `src/routes/sharing.js`
**db_tables:** `receiver_sessions`, `receiver_session_events`, `receiver_claim_tokens`

---

### 4. Recipient Deep-Link / App-Wall Handoff

**user_story:** As a recipient on iOS, I want tapping "Open in Porizo" on the share page to open the installed app directly, and if the app is not installed, to be taken to the App Store with the gift context preserved.

**expected_behavior:**

- Service: `src/services/app-link-service.js` — `buildReceiverSaveUrl({ shareId, receiverSessionId, receiverHandoffId, contentKind, placement })`
- If `APPSFLYER_ONELINK_BASE_URL` env var is set AND `receiverHandoffId` is provided:
  - Builds OneLink URL with params: `pid=share_receiver`, `c=shared_gift_receiver`, `deep_link_value=<receiverHandoffId>`, `deep_link_sub1=<receiverSessionId>`, `deep_link_sub2=<contentKind>`, `deep_link_sub3=<placement>`, `af_xp=custom`
- Fallback (no OneLink): `/download?channel=appstore&deep_link=porizo:///receiver-handoff/<receiverHandoffId>&receiver_session_id=...&utm_*`
- Custom scheme: `porizo:///receiver-handoff/<handoffId>` — deep links directly to receiver handoff resolution in iOS app
- iOS app-wall JavaScript (client-side, not backend): `tryOpenInstalledApp(handoffId, fallbackUrl)` — sets `window.location.href` to custom scheme, arms `visibilitychange` + `pagehide` listeners + 1200ms timeout for App Store fallback
- Share page (`GET /share/:shareId`) serves HTML that includes the app-wall CTA with two actions: "Open in Porizo" (custom scheme only, no timer) and "Get it free" (OneLink → App Store)
- Browser crawlers (Facebook, WhatsApp, etc.) are detected and served OG meta card HTML, not the app wall

**status:** implemented
**evidence:**

- `src/services/app-link-service.js` — full `buildReceiverSaveUrl` confirmed
- `src/routes/sharing.js` line ~850–980 — browser detection and OG/app-wall HTML serving confirmed
- Session memory notes confirm commit 457da8f: "FINAL design — app-wall is TWO actions"
- Custom scheme `porizo:///receiver-handoff/<id>` confirmed in `app-link-service.js` fallback path

**gaps:**

- `tryOpenInstalledApp` 1200ms timer + `visibilitychange` race: if iOS shows an "Open in Porizo?" confirmation dialog and the user is slow to respond, the 1200ms timer fires and sends them to the App Store — user sees both the app AND the App Store tab open
- iOS bfcache: when user returns from the app to Safari, the page is restored from bfcache — stale `settled` state in the JS timer may suppress the app-opening attempt or trigger a spurious App Store redirect
- `pagehide` fires before `visibilitychange` on some iOS versions but the reverse on others — `onHide` deduplication via a `settled` flag guards this but its correctness depends on ordering which iOS does not guarantee
- When app is NOT installed, `window.location.href = 'porizo://...'` triggers an iOS "Cannot Open Page" dialog — the design cannot suppress this dialog; it is a known UX friction point

**key_files:** `src/services/app-link-service.js`, `src/routes/sharing.js`
**db_tables:** `receiver_sessions`

---

### 5. ReceiverHandoffId Persistence (download → login → claim lifecycle)

**user_story:** As a recipient who downloads the app and logs in, I want the gift context I had on the share page to be preserved so that the app knows which gift to claim after sign-in.

**expected_behavior:**

- Handoff ID format: `rh_<24 hex chars>` (validated with regex `/^rh_[a-f0-9]{24}$/`)
- Generated: `generatePrefixedId("rh", 12)` at session creation; 14-day expiry `handoff_expires_at`
- Persisted: in `receiver_sessions.receiver_handoff_id` (UNIQUE index); passed to iOS app via OneLink `deep_link_value` param OR custom scheme `porizo:///receiver-handoff/<id>`
- Rotation: `rotateReceiverHandoffIfNeeded(session)` — if current handoff is resolved or expired, generates a new one with optimistic locking (`WHERE receiver_handoff_id = ? AND (handoff_resolved_at IS NOT NULL OR handoff_expires_at < ?)`) — up to 3 retries
- Lookup: `lookupHandoff(handoffId)` — validates format, queries DB, checks expiry, returns `{ shareId, receiverSessionId, contentKind, handoffResolvedAt }`
- Consumption: `consumeHandoff(handoffId)` — sets `handoff_resolved_at = NOW()` with `WHERE handoff_resolved_at IS NULL` guard
- Full resolution: `resolveHandoff(handoffId)` = `lookupHandoff` + `consumeHandoff`
- Lifecycle: `rh_*` created on first web play → embedded in OneLink/custom scheme → app opens and resolves handoff → `handoff_resolved_at` stamped → if user returns to web, handoff auto-rotates to a new ID

**status:** implemented
**evidence:**

- `src/services/receiver-session-service.js` — `lookupHandoff`, `consumeHandoff`, `resolveHandoff`, `rotateReceiverHandoffIfNeeded` all confirmed
- Regex `/^rh_[a-f0-9]{24}$/` confirmed in lookupHandoff
- `generatePrefixedId("rh", 12)` — 12 bytes = 24 hex chars confirmed
- `migrations/pg/103_receiver_sessions.sql` — `receiver_handoff_id TEXT UNIQUE` confirmed

**gaps:**

- `resolveHandoff` returns null if `consumeHandoff` fails (race) — but does not return an error code distinguishing "already consumed by another process" from "handoff not found"; iOS must handle this gracefully
- 14-day expiry is hard-coded in the service (not configurable) — if recipient delays app install > 14 days, handoff is gone and they must navigate to the share URL again (no re-delivery mechanism)
- No confirmed server endpoint that the iOS app calls to `resolveHandoff` — the iOS app must call some route; this wiring was not confirmed in the routes audit
- `download_attributed_at` column exists but no confirmed code path populates it

**key_files:** `src/services/receiver-session-service.js`, `src/services/app-link-service.js`
**db_tables:** `receiver_sessions`

---

### 6. SMS Gift Delivery (Twilio)

**user_story:** As a sender, I want to send a gift song via SMS to a recipient's phone number so they receive a personalized link in a text message.

**expected_behavior:**

- Gift orders have `channels_json` (e.g. `["sms","email"]`) and `recipient_phone`
- `gift_delivery_outbox` table (migration 081) per-channel row: `channel='sms'`, `recipient=<phone>`, `status: pending|sending|sent|failed|cancelled`
- Delivery dispatched via `gift-delivery-ops.js` functions
- Provider: Twilio (confirmed from `normalizeTwilioReceipt` in `gift-delivery-ops.js`)
- Twilio receipt status mapping: `queued→accepted`, `accepted→accepted`, `sending→sent`, `sent→sent`, `delivered→delivered`, `undelivered→undelivered`, `failed→failed`, `read→delivered`
- `sms-service.js` handles phone verification OTP (separate from gift delivery) — `sendVerificationCode(phoneNumber)` uses Twilio `messages.create`
- Opt-out/STOP: Twilio error code `21610` mapped to user-friendly message "This phone number has opted out of SMS messages" in verification flow; gift delivery Twilio STOP handling not separately confirmed
- Phone E.164 normalization via `normalizePhoneNumber()`
- Phone masking via `redactPhone()` (last 4 digits only) for logs
- Rate limit on OTP: per-phone sliding window before sending

**status:** partial
**evidence:**

- `migrations/pg/081_gift_delivery_outbox.sql` — outbox table with `channel TEXT NOT NULL` (sms|email) confirmed
- `src/services/gift-delivery-ops.js` — `normalizeTwilioReceipt` confirmed, Twilio error code handling in `sms-service.js` confirmed
- `src/services/sms-service.js` — OTP delivery via Twilio confirmed; gift delivery via same Twilio account inferred

**gaps:**

- No confirmed `sendGiftSms()` function in `sms-service.js` or `gift-delivery-ops.js` — only OTP delivery is clearly implemented via `sendVerificationCode`; the actual gift SMS dispatch call site was not found
- No STOP/opt-out handling at the gift delivery level — only at the OTP level; a STOP recipient will receive a failed delivery with no automated cleanup
- `next_retry_at` exists on the outbox row but the retry scheduler job was not confirmed in routes or a cron setup
- No per-gift-phone rate limit separate from the OTP rate limit

**key_files:** `src/services/gift-delivery-ops.js`, `src/services/sms-service.js`
**db_tables:** `gift_delivery_outbox`, `gift_orders`

---

### 7. Email Gift Delivery (Resend)

**user_story:** As a sender, I want to send a gift song via email to a recipient's email address so they receive a rich HTML email with a personalized link.

**expected_behavior:**

- `gift_delivery_outbox` table row with `channel='email'`, `recipient=<email>`, `provider_name='resend'`
- Resend webhook receipt normalization via `normalizeResendReceipt()` in `gift-delivery-ops.js`:
  - `email.sent → sent`, `email.delivered → delivered`, `email.delivery_delayed → sent`, `email.bounced → bounced`, `email.complained → complained`, `email.failed → failed`
  - `providerMessageId`: `data.email_id || data.id || payload.created?.id`
- `email-service.js` — transactional email sending via Resend SDK; templates confirmed for nurture/follow-up sequences
- Marketing contact bounce handling: `marketing_contacts.status` set to `'bounced'` or `'unsubscribed'`; `marketing_engagements` table tracks opens/clicks/bounces/unsubscribes per campaign
- Admin UI: `/admin/dashboard/marketing/email-templates` lists templates; `/admin/dashboard/marketing/cold-email` manages cold campaigns
- Webhook endpoint: `/webhooks/resend` (inferred from `normalizeResendReceipt` existence and provider_name)

**status:** partial
**evidence:**

- `src/services/gift-delivery-ops.js` — `normalizeResendReceipt()` confirmed with full event-type mapping
- `migrations/pg/070_d2c_contacts.sql` — `marketing_contacts` bounce/unsubscribe tracking confirmed
- `migrations/pg/084_gift_ops_observability.sql` — `receipt_status`, `receipt_event_at`, `receipt_payload_json` on outbox confirmed

**gaps:**

- No confirmed `sendGiftEmail()` function call site in `email-service.js` specific to gift delivery — only normalization logic found
- No confirmed webhook route `POST /webhooks/resend` in routes grep — if missing, receipt updates never fire and outbox rows stay in `sent` indefinitely
- `email.complained` (spam report) maps to `complained` receipt status but there is no confirmed block-list update for the complainant's address
- No bounce-back loop: if gift email bounces, there is no automatic retry to a fallback channel (e.g. SMS) even when both channels are in `channels_json`

**key_files:** `src/services/gift-delivery-ops.js`, `src/services/email-service.js`
**db_tables:** `gift_delivery_outbox`, `gift_orders`, `marketing_contacts`

---

### 8. Push Notifications — Transactional (APNs)

**user_story:** As a sender, I want to receive a silent push notification when my song render completes so the app can refresh in the background without polling.

**expected_behavior:**

- Service: `src/services/push-notification.js`
- Provider: Apple APNs via `@parse/node-apn` package
- Function: `sendSilentPush(pushToken, payload)` — validates push token with `APNS_TOKEN_RE = /^[0-9a-fA-F]{64}$/`
- APNs provider instantiated lazily; rotated every 50 minutes (`APNS_TOKEN_TTL_MS`) to avoid JWT expiry
- Notification type: silent push (`content-available: 1`, no `alert`) — wakes app in background
- Configuration env vars: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` (default: `porizo.ios.app.PorizoApp`), `APNS_PRODUCTION`
- Push token stored per-user/device (presumably in `users` or `user_devices` table — not confirmed)

**status:** implemented
**evidence:**

- `src/services/push-notification.js` lines 1–100 confirmed: `sendSilentPush`, `getProvider`, token rotation, `APNS_TOKEN_RE` validation

**gaps:**

- No `user_devices` or `push_tokens` table confirmed in migrations — device push token storage mechanism unknown; could be a column on `users` table
- No confirmed call site where `sendSilentPush` is invoked (e.g., after render completion in job runner) — the function exists but wiring to job completion is not confirmed
- No delivery confirmation: APNs does not return delivery receipts for silent pushes; no retry or fallback if device is offline
- No Android push support — only APNs; Android recipients receive no render-complete notification
- Token rotation on provider object is every 50min but APNs JWT tokens expire every 1 hour — the margin is slim if a single `sendSilentPush` takes >10 minutes

**key_files:** `src/services/push-notification.js`
**db_tables:** unknown (push token storage not confirmed)

---

### 9. Push Notifications — Marketing (OneSignal)

**user_story:** As an admin, I want to send engagement push notifications to re-engage dormant users or notify specific users of gift events.

**expected_behavior:**

- Service: `src/services/onesignal.js`
- Provider: OneSignal REST API (`https://api.onesignal.com`) — no SDK, raw HTTP
- Two dispatch functions confirmed:
  1. `sendToSegment({ segments, title, body, data, imageUrl, name })` — sends to named OneSignal segments (e.g., "Dormant 7-14 Days"); `included_segments` field
  2. `sendToUsers({ userIds, title, body, data, imageUrl, name })` — sends to specific Porizo user IDs mapped as OneSignal `external_id`; uses `include_aliases: { external_id: userIds }`
- Payload shape: `{ app_id, target_channel: "push", included_segments/include_aliases, headings: {en}, contents: {en}, data?, ios_attachments? }`
- `updateUserTags({ userId, tags })` function for segmentation
- Configuration: `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY` env vars
- No player_id usage confirmed — uses external_id aliasing instead (modern OneSignal API)

**status:** implemented
**evidence:**

- `src/services/onesignal.js` full content confirmed — `sendToSegment`, `sendToUsers`, `updateUserTags` functions confirmed
- Payload shape confirmed with `target_channel: "push"`, `include_aliases.external_id` pattern

**gaps:**

- No confirmed call site for `sendToUsers` in gift/share domain — it is unclear when a "gift ready" or "share claimed" push is triggered through OneSignal vs APNs
- No idempotency / deduplication — calling `sendToUsers` twice with the same payload sends two notifications
- No delivery receipt handling from OneSignal webhooks — notifications may silently fail
- `sendToSegment` with broad segments (e.g., all dormant users) has no per-call rate limit guard at the application layer

**key_files:** `src/services/onesignal.js`
**db_tables:** none (push tokens in OneSignal, not local DB)

---

### 10. Share Access Logging

**user_story:** As an admin/analytics system, I want every meaningful interaction with a share link logged so that engagement can be measured and abuse detected.

**expected_behavior:**

- Table: `share_access_log` (song shares), `poem_share_access_log` (poem shares)
- Service helper: `addShareAccessLog({ shareTokenId, eventType, metadata })` in `share-service.js`
- Event types confirmed in `src/routes/sharing.js`:
  - `web_viewer_opened` — share page opened in browser
  - `web_player_opened` — share page opened with web player
  - `gift_link_opened` — gift-specific share page opened
  - `embed_player_opened` — embedded player opened
  - `link_opened` — generic link opened
  - `audio_served` — audio file served to web client
  - `stream_started` — streaming started (claimed or unclaimed)
  - `claim_success` — token successfully claimed
  - `claim_failed` — claim failed (with reason: `token_already_bound`, `token_already_claimed_by_another_user`, `claim_race`, etc.)
  - `share_cover_served` — OG cover image served
  - `share_cover_fallback_served` — fallback OG image served
  - `share_mp4_served` — MP4 video served
  - `audiogram_downloaded` — audiogram downloaded
  - `playlist_served` — HLS playlist served
  - `revoked` — token revoked by creator
  - `access_denied` — claimed token accessed by wrong device
- Stats endpoint: `GET /tracks/:id/share/stats` returns per-event counts + last 10 log entries
- Migration 028 adds `creator_id`, attribution columns to `share_access_log`

**status:** implemented
**evidence:**

- `src/routes/sharing.js` — 60+ `addShareAccessLog` calls confirmed across all event types
- `migrations/pg/028_share_attribution.sql` confirmed
- Stats query confirmed: `GROUP BY event_type` with `MAX(created_at) as last_at`

**gaps:**

- No confirmed index on `share_access_log.share_token_id` — full table scans on the stats query if the table grows large
- `metadata` stored as JSON but no schema enforcement — different callers use different metadata shapes for the same `eventType`
- No retention policy / TTL on `share_access_log` — unbounded growth
- `poem_share_access_log` is a separate table; cross-content analytics must UNION both tables

**key_files:** `src/services/share-service.js`, `src/routes/sharing.js`
**db_tables:** `share_access_log`, `poem_share_access_log`

---

### 11. Share Follow-Ups

**user_story:** As a sender, I want to receive a sequence of follow-up emails after creating a share link to be reminded to send more songs and to leave a rating.

**expected_behavior:**

- Service: `src/services/share-followup-service.js` — pure scheduling / copy logic, intentionally DB-free
- Table: `share_followups` (migration 114) — `id`, `share_token_id → share_tokens(id) ON DELETE CASCADE`, `sender_user_id → users(id)`, `stage TEXT`, `send_at TIMESTAMPTZ`, `sent_at`, `resend_email_id`, `skip_reason`
- Three stages:
  - `sender_24h` — 24 hours after share creation; encourage second song / check reactions
  - `sender_72h` — 72 hours; invite rating + share-back loop
  - `sender_7d` — 7 days; reactivation nudge with specific use case
- `UNIQUE (share_token_id, stage)` — no duplicate stage per share
- Index `share_followups_pending_idx ON share_followups(send_at) WHERE sent_at IS NULL AND skip_reason IS NULL`
- `scheduleFollowups(shareTokenId, senderUserId)` creates the three rows
- `sent_at` stamped + `resend_email_id` stored on successful send
- `skip_reason` set to skip a stage (e.g., share revoked, sender unsubscribed)
- Email copy for each stage returned as structured objects with subject/body/CTA
- Integration plan: `docs/plans/2026-05-22-share-email-followup-sequence.md`

**status:** partial
**evidence:**

- `migrations/pg/114_share_followups.sql` — table schema confirmed
- `src/services/share-followup-service.js` — stage schedule confirmed, pure scheduling confirmed
- Comment: "The integration layer (DB persistence, job runner, wire-in to share creation) is documented in docs/plans/..."

**gaps:**

- Integration layer (DB persistence + job runner + wire-in to share creation) explicitly marked as not yet implemented in the service file comment — the `share_followups` table exists but it is unclear if rows are being created on share creation in production
- No confirmed cron / job runner that sweeps `share_followups_pending_idx` and dispatches the emails
- No confirmed `sent_at` update path — if the email send fails partway, the row may remain unsent with no retry counter
- `migration 115` adds `users.unsubscribed_at` but the followup service does not confirm it checks this flag before sending

**key_files:** `src/services/share-followup-service.js`
**db_tables:** `share_followups`, `share_tokens`, `users`

---

### 12. Gift Funding (Wallet, Reservations, Billing)

**user_story:** As a sender purchasing a gift, I want my gift token to be reserved before content is created so that refunds are possible if generation fails, and gift content does not consume subscription credits.

**expected_behavior:**

- Service: `src/services/gift-funding.js`
- **NOTE: `billing_holds` table was RETIRED** — migration (post-112) drops `billing_holds` and removes `track_versions.billing_hold_id`; the column was scaffolded but never used in production (0 rows)
- **Replacement model:** Gift wallet (`gift_wallet` table) + reservations (`gift_reservations` table)
- `gift_wallet` table: `user_id PK`, `balance INTEGER`, `updated_at` — balance cache
- `gift_wallet_transactions` table: immutable ledger with `type`, `amount`, `balance_before`, `balance_after`, `source`, `reference_type`, `reference_id`, `idempotency_key`
- `UNIQUE INDEX idx_gift_wallet_tx_idempotency ON gift_wallet_transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — idempotent credit ops
- `gift_reservations` table: `id`, `user_id`, `status` (reserved|content_ready|finalized|cancelled|expired), `content_type`, `content_id`, `version_num`, `token_transaction_id`, `refund_transaction_id`, `gift_order_id`, `idempotency_key`, `expires_at`
- `UNIQUE INDEX idx_gift_reservations_user_active ON gift_reservations(user_id) WHERE status IN ('reserved', 'content_ready')` — one active reservation per user
- Validation: `validateGiftFundingReservation(db, { userId, reservationId, contentType })` — checks existence, ownership, finalization, expiry, content type match, existing content uniqueness
- Content lookup: `findGiftFundingContent(db, { reservationId, contentType })` — finds song or poem linked to reservation
- `gift_reservation_id` FK on `tracks` and `poems` tables; `funding_source` column: `'standard'|'gift_token'`
- `CHECK (funding_source IN ('standard', 'gift_token'))` constraint enforced in DB
- Gift bundles: `gift_bundles` table — `product_id`, `token_count`, `price_cents`, `display_name`; live products: `gift_bundle_1` (1×, $4.99), `gift_bundle_3` (3×, $12.99), `gift_bundle_5` (5×, $17.99)

**status:** implemented
**evidence:**

- `src/services/gift-funding.js` — `validateGiftFundingReservation`, `findGiftFundingContent` confirmed
- `migrations/pg/059_gift_reservations.sql` — full schema confirmed
- `migrations/pg/060_gift_bundles.sql` — bundle products confirmed
- `migrations/pg/082_gift_funding_source.sql` — `funding_source` + `gift_reservation_id` on tracks/poems confirmed
- Retirement of `billing_holds` confirmed in migration comments

**gaps:**

- `UNIQUE INDEX idx_gift_reservations_user_active` means a user can only have ONE active reservation at a time — if a user tries to gift two songs simultaneously (e.g. two browser tabs), the second create will fail with `GIFT_RESERVATION_NOT_ACTIVE`
- No confirmed atomic decrement of `gift_wallet.balance` — the wallet balance is a cache, but if the ledger transaction and cache update are not in a DB transaction, the balance can go negative on concurrent purchases
- Reservation expiry: `expires_at` is checked in `isReservationExpired()` at validation time but there is no confirmed background job that marks expired reservations as `'expired'` in the DB
- Refund path: `refund_transaction_id` column exists but no `refundReservation()` function was confirmed in the service

**key_files:** `src/services/gift-funding.js`
**db_tables:** `gift_wallet`, `gift_wallet_transactions`, `gift_reservations`, `gift_bundles`, `tracks`, `poems`

---

### 13. OG Image / Meta for Share Page

**user_story:** As a social media user receiving a share link, I want to see a rich preview card with the song artwork and recipient name so I know the gift is genuine before clicking.

**expected_behavior:**

- Service: `src/services/song-og-generator.js` + `src/services/og-variant-dispatcher.js`
- Primary: `generateSongArtworkPreviewImage({ coverPath, width, height })` — artwork-first; Sharp-based JPEG generation
- Variant support:
  - Standard OG (1200×630): `share_og_1200x630.jpg`
  - WhatsApp square (1200×1200): `share_artwork_1200x1200_whatsapp.jpg` (real artwork) OR `share_og_1200x1200_whatsapp.jpg` (branded fallback)
- Caching: files written to `storage/tracks/<userId>/<trackId>/v<n>/` on first request; `fs.existsSync` check before regenerating; `removeUnreadableFile` guard before checking
- Cache-Control: `public, max-age=14400` (4 hours) for cover images
- WhatsApp detection: `isWhatsAppCrawlerUserAgent(userAgent)` — `variant=whatsapp` query param triggers square generation
- Facebook/WhatsApp crawlers: `isFacebookCrawler || isWhatsApp` → `includeVideoMeta = false` (image cards only)
- OG title constructed from `senderDisplayName`, `recipientName`, `occasion` with fallback: "Someone made you a song!"
- Admin OG variant selection: `GET /tracks/:id/og-previews` (all variants), `GET /tracks/:id/og-preview/:variant` (single)
- `song-og-generator.js` doc: "artwork-first social preview — branded/text-heavy OG cards are useful as fallback but make Facebook/WhatsApp shares look generic"
- OG variant names listed in `SONG_VARIANT_NAMES` constant; `og_variant` column on `tracks` table

**status:** implemented
**evidence:**

- `src/routes/sharing.js` line ~2620 confirmed: WhatsApp square variant generation path with `generateSongArtworkPreviewImage` and `generateSongOgPreview` fallback
- OG title construction confirmed in `src/routes/sharing.js` lines ~970–1005
- `src/services/song-og-generator.js` `generateSongArtworkPreviewImage` confirmed
- WhatsApp 1200×1200 serving confirmed with `variant: "whatsapp"` QS param

**gaps:**

- OG images are generated on-demand and cached on local filesystem — on Railway (ephemeral container), the cache is lost on every deploy/restart; first request after deploy will always regenerate
- No CDN/S3 serving for OG images — `Cache-Control: public, max-age=14400` is served from the app server; under heavy share traffic this is a bottleneck
- `removeUnreadableFile` guard deletes unreadable cached files but does not handle the race where two concurrent requests both miss the cache and both try to write the same file
- `song-og-generator.js` requires Sharp; if Sharp native bindings fail (Alpine Linux / ARM mismatch), OG image generation fails silently returning null, and the route falls through to a branded card (no hard error)

**key_files:** `src/services/song-og-generator.js`, `src/services/og-variant-dispatcher.js`, `src/routes/sharing.js`
**db_tables:** `tracks`, `track_versions` (local filesystem cache, not S3)

---

### 14. Viral Loop / Events Tracking

**user_story:** As the growth team, I want all share-related user actions tracked so that the viral coefficient can be measured and funnel drop-offs identified.

**expected_behavior:**

- Service: `src/services/events-service.js` — `EventsService` class
- Method: `emit(eventName, { id, userId, resourceType, resourceId, metadata, ip, userAgent })`
- Storage: `INSERT INTO events (id, event_name, user_id, resource_type, resource_id, metadata_json, ip_address, user_agent, created_at)` with `ON CONFLICT DO NOTHING` for idempotent inserts (caller supplies `id`)
- Event names confirmed emitted in share context:
  - `share_stream` — streaming started from share page
  - `share_claim` — (inferred from stats/analytics references)
  - `receiver_*` events — play started, CTA viewed/clicked, app opened
- `viral_loop_metrics` view confirmed in migration 116 (not audited in detail)
- `client_receiver_events` table referenced in session memory — client-side events forwarded from web player
- `receiver_session_events` table (migration 103) stores fine-grained session events separately from the main `events` table

**status:** implemented
**evidence:**

- `src/services/events-service.js` — class constructor, `emit()` method with idempotent INSERT confirmed
- `events-service-functions` grep confirmed: `emit`, `on`, `receiver_` and `share_` event name references
- `migrations/pg/116_viral_loop_metrics_view.sql` confirmed in migration list
- `eventsService.emit("share_stream", {...})` call in `src/routes/sharing.js` confirmed

**gaps:**

- `events` table has no confirmed index on `event_name` + `created_at` — queries filtering by event type over time will be slow at scale
- No confirmed aggregation pipeline or materialized view refresh — `viral_loop_metrics` view may be too expensive for real-time dashboard use on a large events table
- `client_receiver_events` — unclear if this is a real table or an event name; if a separate table, schema not confirmed
- No sampling or rate limiting on the events INSERT — a bot hammering the share page will generate unbounded events rows
- Idempotent insert requires caller to supply `id` — most callers in sharing.js do NOT supply an id, making events non-idempotent (retried HTTP requests will double-insert)

**key_files:** `src/services/events-service.js`, `src/routes/sharing.js`
**db_tables:** `events`, `receiver_session_events`, `viral_loop_metrics` (view)

---

### 15. App-Wall / Browser Detection

**user_story:** As a recipient opening a share link in a browser, I want a clean "open in app" experience, while social crawlers see rich OG metadata cards.

**expected_behavior:**

- User-agent detection in `src/routes/sharing.js` + `src/server.js`:
  - `isSocialCrawlerUserAgent(ua)` — broad social crawler regex (Facebook, Twitter, Slack, Discord, LinkedIn, WhatsApp, Telegram, Pinterest, Skype)
  - `isFacebookCrawlerUserAgent(ua)` — `/(facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|...)/i`
  - `isWhatsAppCrawlerUserAgent(ua)` — `/whatsapp/i`
- Crawler path: serve OG meta HTML (no redirect, no app wall)
- Non-crawler path: serve web player HTML with app-wall CTA
- The web player IS the default — the design does NOT auto-redirect mobile traffic based on referer or user-agent heuristics (comment in code: "Auto-redirecting mobile traffic based on referer heuristics breaks real social handoff paths")
- `claim_policy = 'app_only'` on share tokens means web claiming is blocked; `web_stream_allowed` controls whether audio can play in browser before claim
- iMessage crawlers: WhatsApp/iMessage crawlers are forced to re-fetch OG cards by including `generated_at` epoch in OG image URL

**status:** implemented
**evidence:**

- `src/routes/sharing.js` lines 850–980 confirmed: `isCrawler`, `isFacebookCrawler`, `isWhatsApp` detection
- `src/server.js` confirmed: `isSocialCrawlerUserAgent`, `isWhatsAppCrawlerUserAgent` function exports
- `src/routes/sharing.js` line 160: `// (which then get cached by iMessage / WhatsApp crawlers for weeks)` comment

**gaps:**

- No User-Agent-based iOS Safari detection to offer a deeper "open in app" experience for mobile web visitors (by design per the comment — but this means Android users see the same web player with no app to open)
- WhatsApp regex is `/whatsapp/i` — overly broad; matches "WhatsApp Business API" bots in some enterprise proxies
- The 4-hour cache on OG images means a share OG card is stale for up to 4 hours if the sender changes the OG variant

**key_files:** `src/routes/sharing.js`, `src/server.js`
**db_tables:** none

---

### 16. Recipient Contact Storage

**user_story:** As the system, I want to store the phone number or email that a gift was addressed to so that re-delivery and analytics are possible.

**expected_behavior:**

- Migration 121 (`121_add_recipient_contact.sql`) adds two columns to `tracks`:
  - `recipient_phone TEXT`
  - `recipient_channel TEXT`
- These store the delivery contact for the recipient on the track itself
- `user_contacts` table (migration 091): the canonical contact authority — `user_id`, `type` (email|phone), `value_normalized`, `value_display`, `verified_at`, `source`, `is_primary`, `is_relay`
- `UNIQUE INDEX idx_user_contacts_verified_unique ON user_contacts(type, value_normalized) WHERE verified_at IS NOT NULL` — prevents two users from owning the same verified contact
- `marketing_contacts` table (migration 070): cold-email contacts, separate from user contacts — `email`, `first_name`, `last_name`, `status` (active|bounced|unsubscribed)

**status:** partial
**evidence:**

- `migrations/pg/121_add_recipient_contact.sql` — `recipient_phone` + `recipient_channel` on `tracks` confirmed
- `migrations/pg/091_user_contacts.sql` — `user_contacts` schema confirmed
- `migrations/pg/070_d2c_contacts.sql` — `marketing_contacts` + `marketing_engagements` confirmed

**gaps:**

- `recipient_contact` as a standalone table (referenced in the audit prompt) does NOT exist — recipient contact is stored as columns directly on `tracks` (migration 121) which is a simpler but less queryable design
- No `recipient_email` column on `tracks` — only `recipient_phone` + `recipient_channel`; the `gift_orders` table has both `recipient_phone` and `recipient_email`
- No confirmation that `recipient_phone` / `recipient_channel` are actually populated at track creation time
- No confirmed encryption of `recipient_phone` at rest — plain-text PII in the tracks table

**key_files:** none (DB-only)
**db_tables:** `tracks` (recipient_phone, recipient_channel), `gift_orders` (recipient_phone, recipient_email), `user_contacts`, `marketing_contacts`

---

### 17. Gift Ops Monitoring

**user_story:** As an ops team, I want automated incident detection for stuck or failed gift deliveries so that we can intervene before recipients miss their gifts.

**expected_behavior:**

- Service: `src/services/gift-ops-monitoring.js`
- Factory: `createGiftOpsMonitor(db)` returns `{ logGiftLifecycle, recordGiftIncident, clearGiftIncident }`
- `logGiftLifecycle(severity, event, data)` — structured logging for gift lifecycle events
- `recordGiftIncident({ incidentKey, incidentType, severity, summary, detail, metadata, giftOrderId, outboxId, reopen })` — upserts to `gift_delivery_incidents` table
- `clearGiftIncident(incidentKey, resolverId)` — calls `resolveGiftIncident(db, incidentKey, resolverId)`
- `gift_delivery_incidents` table (migration 084): `incident_key UNIQUE`, `incident_type`, `severity`, `status` (open|acknowledged|resolved), `gift_order_id`, `outbox_id`, `resource_type`, `resource_id`, `summary`, `detail`, `metadata_json`, `acknowledged_at/by`, `resolved_at/by`
- Admin query: `listOrders` in admin-gift-ops service returns `open_incident_count` per order via subquery on `gift_delivery_incidents WHERE status IN ('open', 'acknowledged')`
- Observability columns on `gift_orders`: `first_dispatch_started_at`, `last_dispatch_completed_at`, `last_successful_delivery_at`, `delivery_lag_ms`, `overdue_detected_at`
- Observability columns on `gift_delivery_outbox`: `provider_name`, `first_queued_at`, `first_attempt_started_at`, `provider_accepted_at`, `receipt_status`, `receipt_event_at`, `receipt_updated_at`, `receipt_payload_json`

**status:** partial
**evidence:**

- `src/services/gift-ops-monitoring.js` — `createGiftOpsMonitor`, `recordGiftIncident`, `clearGiftIncident`, `upsertGiftIncident` confirmed
- `migrations/pg/084_gift_ops_observability.sql` — full schema confirmed
- Admin gift-ops confirmed: `open_incident_count` subquery in `listOrders`

**gaps:**

- No `ALERT_THRESHOLDS` constants found in `gift-ops-monitoring.js` grep — the thresholds for triggering an incident (e.g., "delivery stuck for > 30 minutes") are not confirmed; `recordGiftIncident` must be called explicitly by the dispatch runner
- No confirmed `checkAlerts()` background job that sweeps overdue orders and auto-opens incidents — incident creation appears to require the dispatch runner to call `recordGiftIncident` explicitly
- `overdue_detected_at` column exists but no confirmed code that sets it
- Incident acknowledgement (`acknowledgeGiftIncident`) exists in `gift-delivery-ops.js` but no admin UI endpoint confirmed for triggering it
- No PagerDuty/Slack webhook integration confirmed for critical incidents

**key_files:** `src/services/gift-ops-monitoring.js`, `src/services/gift-delivery-ops.js`
**db_tables:** `gift_delivery_incidents`, `gift_orders`, `gift_delivery_outbox`

---

### 18. Stream Key / Audio Access

**user_story:** As a recipient, I want to play the song in my browser or the app without needing to be fully authenticated.

**expected_behavior:**

- `stream_key_id` (UUID) and `stream_key` (16 bytes, base64-encoded) generated per share token at creation
- Stream key stored in `share_tokens.stream_key`
- Audio endpoint: `GET /share/:shareId/audio`
- For `unbound` shares: `web_stream_allowed` flag checked; if false → 403 `WEB_STREAM_NOT_ALLOWED`
- For `unbound` shares where streaming is allowed: returns `{ stream_url, cdn_enabled: false, format: "audio", expires_at: +30min }`
- `expires_at` is a soft advisory only — the actual audio endpoint does not validate it (no signed URL)
- For claimed shares: `bound_device_id` check enforced before serving stream URL to app callers
- Stream key used at line 3087: `Buffer.from(share.stream_key, "base64")` — key decryption for playlist endpoint
- HLS playlist endpoint: `GET /share/:shareId/playlist` — AES-128 encrypted HLS stream keyed with the per-share stream_key
- Fallback audio endpoint serves the preview.m4a directly (`sendMediaFile`)
- `cache-control: public, max-age=300` (5 min) on audio responses

**status:** implemented
**evidence:**

- `src/routes/sharing.js` — audio endpoint, web_stream_allowed check, stream_url construction confirmed
- Stream key buffer usage at line 3087 confirmed for HLS decryption
- `addShareAccessLog eventType: "stream_started"` confirmed

**gaps:**

- No signed URL or time-limited token on the `/share/:shareId/audio` endpoint — anyone who knows the shareId can request audio; the only guard is `web_stream_allowed` flag
- `expires_at: +30min` in the stream response is advisory only — the actual audio endpoint has no expiry enforcement; a client that stores the audio URL can re-request it days later
- AES-128 HLS key endpoint not confirmed — if the stream key endpoint does not verify the requester, the encryption provides no real protection
- `cache-control: public, max-age=300` on audio files means audio is cached by CDN/proxies — CDN nodes could serve audio after share is revoked for up to 5 minutes

**key_files:** `src/routes/sharing.js`
**db_tables:** `share_tokens` (stream_key, web_stream_allowed)

---

### 19. Share Token Revocation / Expiry

**user_story:** As a sender, I want to be able to revoke a share link I created so that the recipient can no longer access the song.

**expected_behavior:**

- Revoke endpoint: `DELETE /tracks/:id/share`
  - Requires auth; verifies track ownership (`track.user_id === userId`)
  - `UPDATE share_tokens SET status = 'revoked' WHERE id = ?`
  - `addShareAccessLog({ eventType: "revoked", metadata: { reason: "creator_revoked" } })`
  - `addAuditEntry({ action: "share_revoked", resourceType: "share_token" })`
  - Response: `{ revoked: true }`
- Revoke check in every share lookup guard: `if (!share || share.status === "revoked")` → 410 `SHARE_REVOKED` or render `shareNotFoundHtml`
- Poem share revocation: `PUT /poems/:id/share/revoke` (inferred; not confirmed separately)
- Expiry: share tokens have `expires_at = '9999-12-31T23:59:59.000Z'` (lifetime) — functional expiry never fires
- Admin revoke: no confirmed `POST /admin/dashboard/shares/:id/revoke` endpoint — admin cannot revoke a specific share from the admin panel without direct DB access
- Status flow: `unbound → claimed` (by recipient) or `unbound → revoked` (by creator)
- Token status values: `unbound`, `claimed`, `revoked`, `expired` (expired is a DB value but never set programmatically since lifetime tokens never expire)

**status:** implemented (with gaps)
**evidence:**

- `src/routes/sharing.js` line 3100–3130 — `DELETE /tracks/:id/share` confirmed
- `share.status === "revoked"` check at lines 298, 674, 775, 869, 1083, 1493, 1585, 2834, 3247, 3330 — comprehensive revoke guard confirmed
- `sendError(reply, 410, "SHARE_REVOKED", ...)` confirmed

**gaps:**

- No admin-facing revoke endpoint — admin cannot revoke a share without direct DB manipulation
- Revocation is not propagated to cached audio files — a recipient's app that already has the stream URL cached can continue playing for up to `cache-control: max-age=300` after revocation
- Claimed tokens cannot be "unclaimed" by the recipient — there is no `release` endpoint
- No webhook or push notification sent to the recipient when their share is revoked — they find out only when next trying to load the share page

**key_files:** `src/routes/sharing.js`
**db_tables:** `share_tokens`, `share_access_log`, `audit_logs`

---

### 20. Rate Limiting on Share Endpoints

**user_story:** As the platform, I want share endpoints protected from abuse and excessive usage.

**expected_behavior:**

- General rate limiting: `rate_limits` table with `user_id`, `action_type`, `window_start_ms`, `window_seconds`, `count`, `limit_count`; sliding-window DB-backed
- Admin auth endpoints: "Two rate-limit dimensions, both fail-closed" confirmed at line 555 in admin routes
- OTP SMS: per-phone rate limit via `checkRateLimit(phone)` before sending verification code
- Share creation: no confirmed explicit per-user rate limit on `POST /tracks/:id/share` beyond the general API rate limit framework
- No 429 response code or `TOO_MANY_REQUESTS` error found in `src/routes/sharing.js` grep — sharing endpoints appear to rely on the general Fastify rate limiting plugin, not a custom per-endpoint limit
- Audiogram download: "rate-limited + signed token" confirmed in comment at line 2816 (`GET /share/:shareId/audiogram`)
- Claim endpoint: no per-IP or per-device rate limit found for `POST /share/:shareId/claim` — a bad actor can hammer claim attempts; only the atomic `WHERE bound_device_id IS NULL` prevents success

**status:** partial
**evidence:**

- `src/routes/sharing.js` — no `rate_limit` table reference or 429 response in the sharing route grep
- Audiogram download comment at line 2816 confirms rate limiting for that specific endpoint
- `sms-service.js` — per-phone OTP rate limit confirmed

**gaps:**

- No per-user or per-IP rate limit on `POST /tracks/:id/share` — a user can create thousands of share tokens per minute
- No per-IP rate limit on `GET /share/:shareId` — bots can enumerate share IDs at will (share IDs appear to be random but enumeration still burns server resources)
- No rate limit on `POST /share/:shareId/claim` — claim endpoint has no brute-force protection beyond the atomic DB guard (which does not stop the requests)
- `claim_attempts` counter exists on `share_tokens` but is reset on success and no confirmed lockout after N failed attempts

**key_files:** `src/routes/sharing.js`
**db_tables:** `rate_limits`

---

### 21. Signed-Out Claim Flow

**user_story:** As a recipient who is not logged in to Porizo when they open the share page, I want to be able to sign in and then have the gift automatically claimed to my account.

**expected_behavior:**

- `POST /share/:shareId/claim` accepts optional `userId` (from auth token if provided)
- `bound_user_id` is set via `COALESCE(?, bound_user_id)` — if `claimUserId` is NULL on first claim, `bound_user_id` stays NULL; a subsequent authenticated claim can bind the user
- The iOS app-wall shows Sign-In-with-Apple in-sheet for signed-out users (confirmed in session memory: "Signed-out claim = Sign-in-with-Apple in-sheet — not a bug")
- After sign-in, iOS calls claim endpoint again with the authenticated `userId`
- `upsertTrackLibraryEntry` with `origin: 'received'` runs only if `claimUserId` is non-null at claim time (line 2244: `if (claimUserId) { await upsertTrackLibraryEntry(...) }`)
- Receiver handoff (`rh_*`) survives across the sign-in flow via OneLink deferred deep link or custom scheme

**status:** implemented (with gaps)
**evidence:**

- `src/routes/sharing.js` — `COALESCE(?, bound_user_id)` pattern confirmed
- `if (claimUserId) { await upsertTrackLibraryEntry(...) }` at line ~2244 confirmed
- Session memory: "Signed-out claim = Sign-in-with-Apple in-sheet (not a bug)"

**gaps:**

- If a user claims signed-out (device binds), then signs in as a different user, the `bound_user_id` remains unset — the track library entry is never created for the signed-in user's library unless they trigger a second claim
- No server-side "deferred claim" mechanism — the iOS app must manually re-call the claim endpoint after sign-in; if the app fails to do so, the gift is device-bound but not in the user's library
- `bound_user_id` being NULL on a `claimed` token means the admin cannot look up "who claimed this gift" — only "which device claimed it"

**key_files:** `src/routes/sharing.js`, `src/services/receiver-session-service.js`
**db_tables:** `share_tokens`, `track_library_entries`

---

### 22. Gift Delivery Outbox / Retry Infrastructure

**user_story:** As the platform, I want gift deliveries to be durable so that transient SMS/email failures are automatically retried without losing the delivery attempt.

**expected_behavior:**

- Table: `gift_delivery_outbox` (migration 081) — per-channel row per gift order
  - `status: pending|sending|sent|failed|cancelled`
  - `attempt_count`, `provider_message_id`, `last_error`
  - `send_after` (scheduled time), `next_retry_at`, `last_attempt_at`
  - `locked_at` — prevents concurrent workers from picking the same row
  - `payload_json` — serialized message payload
  - `provider_name`: `'twilio'` (SMS) or `'resend'` (email)
  - `receipt_status`, `receipt_event_at`, `receipt_payload_json` (migration 084)
- `UNIQUE INDEX idx_gift_delivery_outbox_gift_channel ON gift_delivery_outbox(gift_order_id, channel)` — one row per channel per order
- `chooseReceiptState({ currentStatus, currentEventAt, nextStatus, nextEventAt })` — prevents receipt status regression (e.g., `delivered` cannot be overwritten by a later `sent`)
- `isTerminalReceiptStatus(status)` — `['delivered', 'undelivered', 'bounced', 'complained', 'failed']`
- Incident resolution: `resolveGiftIncidentsForGift(db, giftOrderId, incidentTypes)` called when delivery succeeds
- Key functions in `gift-delivery-ops.js`: `normalizeTwilioReceipt`, `normalizeResendReceipt`, `upsertGiftIncident`, `acknowledgeGiftIncident`, `resolveGiftIncident`, `chooseReceiptState`

**status:** implemented (schema + normalization layer); retry runner status unknown
**evidence:**

- `migrations/pg/081_gift_delivery_outbox.sql` — full outbox schema confirmed
- `migrations/pg/084_gift_ops_observability.sql` — receipt columns + incidents table confirmed
- `src/services/gift-delivery-ops.js` — normalization and incident functions confirmed

**gaps:**

- No confirmed retry scheduler / background worker that sweeps `WHERE status IN ('pending', 'failed') AND next_retry_at <= NOW()` — the outbox exists but the runner that drives it was not found in routes or a cron/job setup
- `locked_at` column exists (pessimistic locking for concurrent workers) but no confirmed worker that acquires/releases the lock
- `UNIQUE INDEX on (gift_order_id, channel)` means re-sending to the same channel (e.g., resend SMS after a STOP opt-out recovery) requires deleting and re-inserting the outbox row rather than adding a new attempt
- `payload_json` content not validated at write time — corrupt payloads could cause delivery workers to fail silently

**key_files:** `src/services/gift-delivery-ops.js`
**db_tables:** `gift_delivery_outbox`, `gift_delivery_incidents`, `gift_orders`

---

### 23. Gift Order Scheduling

**user_story:** As a sender, I want to schedule a gift to be delivered at a specific date and time in the recipient's timezone.

**expected_behavior:**

- Table: `gift_orders` (migration 056):
  - `delivery_mode: immediate|scheduled`, `send_at`, `sender_timezone`
  - `status: scheduled|dispatching|dispatched|cancelled|failed|dispatch_retry`
  - `dispatch_status: pending|sent|retrying|failed|cancelled`
  - `channels_json` (JSON array, e.g. `["sms","email"]`)
  - `content_snapshot_json` — frozen content snapshot at dispatch time (migration 080)
  - `next_retry_at`, `dispatch_started_at` (migration 080), `dispatch_attempts`
  - `claim_pin`, `claim_policy: 'app_only'` default
  - `share_token_id`, `share_url` stored on order
  - `sender_display_name` (migration 086), `gift_recipient_name` (migration 085)
- Routes: `src/routes/gifts.js` — confirmed with endpoints for gift orders (exact paths not captured)
- `gift_reservations` linked to `gift_orders` via `gift_order_id`

**status:** implemented (schema); dispatch runner status unknown
**evidence:**

- `migrations/pg/056_gift_scheduling_and_wallet.sql` — full schema confirmed
- `migrations/pg/080_gift_delivery_hardening.sql` — `content_snapshot_json`, retry fields confirmed
- `migrations/pg/085_gift_order_recipient_name.sql` + `086_gift_sender_display_name.sql` confirmed in migration list

**gaps:**

- No confirmed dispatch runner / cron that picks up `WHERE status = 'scheduled' AND send_at <= NOW()` and transitions to dispatching
- `content_snapshot_json` is stored but if the track render is still in progress at `send_at`, the snapshot may be incomplete
- No timezone-safe `send_at` enforcement — `send_at` is stored as TEXT (ISO string), not `TIMESTAMPTZ`; timezone conversion errors at scheduling time are possible
- No confirmed refund path when a scheduled gift order is cancelled after funds have been deducted

**key_files:** `src/routes/gifts.js`, `src/services/gift-funding.js`
**db_tables:** `gift_orders`, `gift_wallet_transactions`, `gift_reservations`

---

### 24. Poem Share Binding

**user_story:** As a poem sender, I want poem shares to have the same device-binding and claim behavior as song shares.

**expected_behavior:**

- Table: `poem_share_tokens` — parallel to `share_tokens`, added by migration 036
- Additional columns (migration 083): poem-specific binding columns (exact columns not captured but migration 083 = `083_poem_share_binding_columns.sql`)
- `poem_share_access_log` table — parallel access log
- Share endpoint: `POST /poems/:id/share`
- Claim endpoint: parallel poem claim in `src/routes/sharing.js`
- `buildShareUrl` / `isShareUsable` called identically for poem shares
- INSERT to `poem_share_tokens` confirmed with identical fields to song shares (status, share*type='lifetime', claim_pin, allow_save, expires_at, utm*\*, created_ip, created_user_agent)

**status:** implemented
**evidence:**

- `migrations/pg/036_poem_sharing.sql` — `poem_share_tokens` table confirmed in migration list
- `migrations/pg/083_poem_share_binding_columns.sql` — binding columns confirmed
- INSERT to `poem_share_tokens` with same fields as `share_tokens` confirmed in share-service code

**gaps:**

- Poem shares are a parallel implementation of song shares rather than a generalized content share — any new feature added to song sharing must be manually mirrored to poem sharing
- `poem_share_access_log` is a separate table — cross-content analytics require UNION queries
- The poem receiver session flow (whether `receiver_sessions.content_kind = 'poem'` is wired through the same app-wall) was not confirmed in detail

**key_files:** `src/services/share-service.js`, `src/routes/sharing.js`
**db_tables:** `poem_share_tokens`, `poem_share_access_log`

---

### 25. Audiogram Download

**user_story:** As a recipient or sender, I want to download a short MP4 video of the song for sharing to Instagram/Facebook natively.

**expected_behavior:**

- Endpoint: `GET /share/:shareId/audiogram` — confirmed in share access log event types
- Described in code comment at line 2816: "Downloadable audiogram for Instagram/Facebook native upload (rate-limited + signed token)"
- Response: binary MP4 file
- Rate-limited per comment; signed token required (exact token mechanism not confirmed)
- `addShareAccessLog({ eventType: "audiogram_downloaded" })` confirmed

**status:** implemented (partially confirmed)
**evidence:**

- Line 2816 comment in `src/routes/sharing.js` confirmed
- `eventType: "audiogram_downloaded"` at line 2908 confirmed

**gaps:**

- Signed token mechanism not confirmed — if it is just a query-string token generated by the server, there is no confirmed expiry enforcement
- No confirmed audiogram generation service — it is unclear if audiograms are pre-generated or on-demand; on-demand Sharp/FFmpeg generation under share traffic could be a bottleneck
- Rate limit implementation not confirmed beyond the comment

**key_files:** `src/routes/sharing.js`
**db_tables:** `share_access_log`

---

## Top 5 Robustness Gaps

1. **Gift delivery retry runner not confirmed** (Features 6, 7, 22): The `gift_delivery_outbox` table with `locked_at`, `next_retry_at`, `attempt_count` is fully designed for a retry worker, but no background job that sweeps and re-dispatches pending/failed rows was found in routes, cron config, or server.js — deliveries that fail on first attempt may never be retried.

2. **No rate limit on `POST /share/:shareId/claim`** (Feature 20): The claim endpoint has no per-IP or per-device rate limit. The only abuse guard is the atomic `WHERE bound_device_id IS NULL AND status = 'unbound'` DB guard. A bot can make unlimited claim attempts (e.g., with different `deviceId` values to probe whether the claim is open) and `claim_attempts` is never incremented on failed attempts before the atomic UPDATE.

3. **Share followup integration layer not implemented** (Feature 11): The `share-followup-service.js` explicitly documents that the DB persistence, job runner, and wire-in to share creation are not yet implemented. The `share_followups` table exists but rows may not be inserted on share creation and there is no confirmed scheduled email dispatcher — the 3-stage nurture sequence may be a no-op in production.

4. **OG images on ephemeral filesystem with no CDN** (Feature 13): OG images are written to local disk (`storage/tracks/.../share_og_*.jpg`) and served directly from the app server with `Cache-Control: public, max-age=14400`. On Railway, the container filesystem is ephemeral — every deploy or restart clears the cache, causing every OG request on the next cold start to trigger Sharp image generation synchronously in the request path. There is also no write-lock on concurrent cache-miss regeneration.

5. **`receiver_claim_tokens` table scaffolded but not wired** (Feature 3): The `receiver_claim_tokens` table (migration 104) with `token_hash`, `expires_at`, `consumed_at` was created to support a secure one-time claim token flow, but no route handler that issues or redeems these tokens was confirmed. The table may be dead schema, meaning the claim security model relies solely on the atomic `WHERE bound_device_id IS NULL` guard rather than the intended token-based handoff.

---

## Feature Count Summary

| #   | Feature                                      | Status      |
| --- | -------------------------------------------- | ----------- |
| 1   | Create Share Link (Lifetime Token)           | implemented |
| 2   | Device-Binding / First-to-Claim              | implemented |
| 3   | Receiver Session / Claim Flow                | implemented |
| 4   | Recipient Deep-Link / App-Wall Handoff       | implemented |
| 5   | ReceiverHandoffId Persistence                | implemented |
| 6   | SMS Gift Delivery (Twilio)                   | partial     |
| 7   | Email Gift Delivery (Resend)                 | partial     |
| 8   | Push Notifications — Transactional (APNs)    | implemented |
| 9   | Push Notifications — Marketing (OneSignal)   | implemented |
| 10  | Share Access Logging                         | implemented |
| 11  | Share Follow-Ups                             | partial     |
| 12  | Gift Funding (Wallet, Reservations, Billing) | implemented |
| 13  | OG Image / Meta for Share Page               | implemented |
| 14  | Viral Loop / Events Tracking                 | implemented |
| 15  | App-Wall / Browser Detection                 | implemented |
| 16  | Recipient Contact Storage                    | partial     |
| 17  | Gift Ops Monitoring                          | partial     |
| 18  | Stream Key / Audio Access                    | implemented |
| 19  | Share Token Revocation / Expiry              | implemented |
| 20  | Rate Limiting on Share Endpoints             | partial     |
| 21  | Signed-Out Claim Flow                        | implemented |
| 22  | Gift Delivery Outbox / Retry Infrastructure  | partial     |
| 23  | Gift Order Scheduling                        | partial     |
| 24  | Poem Share Binding                           | implemented |
| 25  | Audiogram Download                           | partial     |

**Total: 25 features** — 15 implemented, 10 partial, 0 broken, 0 unknown
