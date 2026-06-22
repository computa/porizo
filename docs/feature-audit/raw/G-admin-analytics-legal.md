# Feature Audit — Domain G: Admin / Analytics / Attribution / Cold-Email / GDPR-Legal

**Audit date:** 2026-06-22  
**Auditor:** Claude Code (automated feature-discovery pass — read-only, no code modified)  
**Files surveyed:**

- `src/routes/admin.js` (~163 KB)
- `src/routes/analytics.js`
- `src/routes/legal.js`
- `src/routes/mcp.js`
- `src/services/admin-service.js`
- `src/services/admin-auth-service.js`
- `src/services/admin-gift-ops-service.js`
- `src/services/attribution-service.js`
- `src/services/cold-email-service.js`
- `src/services/gdpr-audit-service.js`
- `src/services/events-service.js`
- `src/services/email-service.js` (admin/campaign side)
- `migrations/pg/*.sql` (066 migrations total, relevant ones called out per feature)

---

## Authorization Architecture (Shared Context)

Two distinct auth layers coexist:

**Admin session auth (Bearer token):**

- Global `onRequest` gate fires on every `/admin/dashboard*` route.
- Extracts `Authorization: Bearer <token>`, calls `adminAuthService.validateSession(token)`.
- Queries `admin_sessions` table for a matching non-expired row; populates `request.admin`.
- `/admin/auth/*` routes are explicitly excluded from this gate and protect themselves inline.
- `requireAdminSession(request, reply)` — inline guard used on all dashboard routes.
- `requireAdminRole(request, reply, allowedRoles)` — calls `requireAdminSession` first, then checks `admin.role` against the provided array (e.g. `["superadmin"]`).
- Two roles observed: `admin` (any authenticated admin) and `superadmin` (destructive/sensitive ops).

**User session auth (separate):**

- Standard user Bearer token auth (`requireAuth` / `verifyToken`) used on analytics, legal GDPR, and MCP routes.
- Completely separate middleware from admin auth.

---

### 1. Admin Account Setup

**feature:** One-time admin account bootstrapping  
**user_story:** Operator sets `ADMIN_SETUP_SECRET` env var and POSTs to bootstrap the first admin account before removing the secret.  
**expected_behavior:**

- `POST /admin/auth/setup` — no session required; protected only by env-var secret comparison (`process.env.ADMIN_SETUP_SECRET`). Creates first row in `admin_users`.
- Response includes: "Admin created. Remove `ADMIN_SETUP_SECRET` to disable this endpoint."
- If env var is absent: `const setupSecret = process.env.ADMIN_SETUP_SECRET` → `undefined`; then `if (secret !== setupSecret)` rejects with 401.

**status:** implemented — code at admin.js:470–506  
**gaps:**

- If `ADMIN_SETUP_SECRET` is not set in env, `setupSecret` is `undefined`. The guard `secret !== setupSecret` compares the body `secret` field (a string) with `undefined` — this correctly rejects any string, so fail-closed. However, if someone sends `secret: undefined` somehow or if the JS coercion produces equality, it could theoretically pass. Low risk but the intent comment says "remove to disable" — it should instead actively reject when the var is absent.
- No rate limiting on this endpoint — an attacker who guesses the secret format can brute-force without lockout.
- No audit log written on successful setup (first admin creation is not recorded in `audit_logs`).
- No check that only one admin can be created this way (could be called multiple times if secret stays set).

**key_files:** `src/routes/admin.js:470–506`, `src/services/admin-auth-service.js`  
**db_tables:** `admin_users`

---

### 2. Admin Authentication (Login / Session / Password Reset)

**feature:** Admin login, session management, password change, forgot/reset password  
**user_story:** Admin operator logs in with email+password, receives a session token, manages their session, and can reset their password via email.  
**expected_behavior:**

- `POST /admin/auth/login` — bcrypt password compare; on success inserts `admin_sessions` row; returns session token. Rate-limited via `rate_limits` table (15-min window). Account lockout after N failed attempts (`failed_login_count`, `locked_until` columns on `admin_users`). Default-seeded admin password blocked in production (`shouldBlockDefaultSeededAdminLogin`).
- `POST /admin/auth/logout` — extracts Bearer token inline, revokes session.
- `GET /admin/auth/me` — `requireAdminSession`; returns current admin info.
- `POST /admin/auth/change-password` — `requireAdminSession`; bcrypt new password; invalidates all other sessions (force re-login everywhere).
- `POST /admin/auth/forgot-password` — public; rate-limited; sends reset email via `sendAdminPasswordResetEmail`.
- `POST /admin/auth/reset-password` — token-based; calls `verifyPasswordResetToken` → `changePassword` → `invalidateAllPasswordResetTokens` + all `admin_sessions`.
- Security alert email (`sendAdminSecurityAlertEmail`) sent on password changes.

**status:** implemented — admin-auth-service.js has full bcrypt + session + lockout + reset flow  
**gaps:**

- **Rate-limit is fail-open** (admin.js:701, comment: "Default fail-open: a transient rate-limit table issue should not lock out admins"). If the DB is unreachable, the rate limiter silently skips, allowing unlimited login attempts. This is a deliberate tradeoff but a significant brute-force window during DB degradation.
- `POST /admin/auth/forgot-password` rate limit: uses same `rate_limits` table (same fail-open risk).
- Token transport is Bearer header (not HttpOnly cookie) — tokens can be exfiltrated via XSS in admin UI if not carefully scoped.
- No explicit session expiry enforcement visible in `validateSession` snippet — depends on `expires_at` column in `admin_sessions` being set correctly at login time.
- No 2FA/MFA.

**key_files:** `src/routes/admin.js:470–700`, `src/services/admin-auth-service.js`, `src/services/email-service.js:150–305`  
**db_tables:** `admin_users`, `admin_sessions`, `rate_limits`

---

### 3. Admin Dashboard Shell (Static UI)

**feature:** Admin SPA shell served at `/admin`  
**user_story:** Admin navigates to `/admin` in a browser; receives the HTML shell that calls the dashboard API endpoints.  
**expected_behavior:**

- `GET /admin` and `GET /admin/dashboard` serve a static HTML file.
- `requireAdminUiAccess(request, reply)` gate: reads `ADMIN_UI_MODE` env var. If `"public"`, serves to all. If `"allowlist"`, checks `ADMIN_UI_ALLOWED_EMAILS` against a session. Unknown value hides the UI entirely (serves 404/empty).

**status:** implemented  
**gaps:**

- `ADMIN_UI_MODE=public` would expose the admin shell URL to anyone — only the API endpoints are then protected by session. Acceptable if intentional (SPA can't do anything without a valid token), but the mode name is misleading.
- No Content-Security-Policy or frame-ancestors headers visible in the grep output.

**key_files:** `src/routes/admin.js:434–468`  
**db_tables:** none (static asset)

---

### 4. User Management (Admin)

**feature:** Admin user listing, inspection, risk scoring, profile edits, entitlement changes, lock/delete  
**user_story:** Admin reviews user accounts, adjusts risk levels, modifies credits, locks suspicious accounts; superadmin deletes accounts or takes bulk actions.  
**expected_behavior:**

- `GET /admin/dashboard/users` — paginated user list with filters; any admin.
- `GET /admin/dashboard/users/stats` — aggregate counts; any admin.
- `GET /admin/dashboard/users/:id` — full user detail (profile + entitlements + recent activity); any admin.
- `PUT /admin/dashboard/users/:id/risk` — update `risk_level`; any admin.
- `PUT /admin/dashboard/users/:id/profile` — update profile fields; any admin.
- `PUT /admin/dashboard/users/:id/entitlements` — update `credits_balance`, `tier`, etc.; any admin (NOT superadmin-gated).
- `GET /admin/dashboard/users/:userId/sessions` — list user auth sessions; any admin.
- `POST /admin/dashboard/users/:id/lock` — lock/unlock account; **superadmin only**.
- `DELETE /admin/dashboard/users/:id` — soft-delete or hard-delete user; **superadmin only**.
- `POST /admin/dashboard/users/bulk-action` — bulk lock/delete/etc.; **superadmin only**.

**status:** implemented  
**gaps:**

- **`PUT .../entitlements` is any-admin, not superadmin-gated.** Arbitrary credit balance manipulation by any admin account is a privilege escalation path if an admin credential is stolen/compromised.
- No audit log written for admin reads of user behavioral data (admin.js:2531 has a comment "audit_logs row on every call" but the implementation is partial — see comment suggesting it was deferred).
- `DELETE /admin/dashboard/users/:id` — unclear if this triggers the full GDPR cascade (raw recording deletion, share token cleanup, etc.) or just soft-deletes `users.deleted_at`. Cascade scope not verified from grep output.
- Bulk action endpoint: the set of valid `action` values and per-action authorization not verified — a body with an unexpected action value could trigger unintended DB writes if not allowlisted.

**key_files:** `src/routes/admin.js:1254–1550`, `src/services/admin-service.js` (empty exports in grep — likely uses inline DB queries)  
**db_tables:** `users`, `entitlements`, `voice_profiles`, `audit_logs`, `rate_limits`

---

### 5. Admin Gift Operations (Gift Order Management)

**feature:** Gift order listing, incident management, acknowledgment, resolution  
**user_story:** Admin reviews gift delivery orders, acknowledges and resolves delivery incidents.  
**expected_behavior:**

- `GET /admin/dashboard/gifts/orders` (inferred from `AdminGiftOpsService.listOrders`) — paginated, filtered list of `gift_orders` with outbox/incident counts.
- `GET /admin/dashboard/gifts/orders/:id` — order detail with last 25 `audit_logs` entries.
- `POST /admin/dashboard/gifts/orders/:id/incidents/:incidentId/acknowledge` — sets `acknowledged_at`, `acknowledged_by` on `gift_delivery_incidents`.
- `POST /admin/dashboard/gifts/orders/:id/incidents/:incidentId/resolve` — sets `resolved_at`, `resolved_by`.

**status:** implemented (service class exists at admin-gift-ops-service.js; route endpoints inferred from service methods)  
**gaps:**

- `AdminGiftOpsService.listOrders` builds a dynamic `WHERE 1=1` SQL filter from a `filters` parameter. If filter key names are not allowlisted server-side (only values are parameterized), this is a SQL column injection vector — an attacker providing an unknown key name could cause query errors or information leakage. Needs explicit key allowlist verification.
- No visible refund/credit-back operation in the service — if a gift order fails, the admin UI may have no mechanism to issue a refund without direct DB manipulation.
- Incident acknowledgment/resolution does not appear to write to `audit_logs` (only reads from it).

**key_files:** `src/services/admin-gift-ops-service.js`, `src/routes/admin.js:1168–1250`  
**db_tables:** `gift_orders`, `gift_delivery_outbox`, `gift_delivery_incidents`, `audit_logs`

---

### 6. Cold Email Campaigns (Admin)

**feature:** Cold email campaign management — list, trigger, pause/activate/drain, template preview  
**user_story:** Superadmin triggers a cold email campaign send; any admin pauses, drains, or re-activates a campaign; admin previews email templates.  
**expected_behavior:**

- `GET /admin/dashboard/marketing/cold-email` — lists all `cold_email_campaigns` rows; any admin.
- `PATCH /admin/dashboard/marketing/cold-email/:id` — updates campaign `status`; valid values: `["active", "paused", "draining"]`; any admin.
- `POST /admin/dashboard/marketing/cold-email/:id/trigger` — schedules a real send batch; **superadmin only**. Calls `coldEmailSvc.loadCampaign` + `processCampaign`. Writes audit log on trigger (admin.js:4242) and on PATCH (admin.js:4498).
- `GET /admin/dashboard/marketing/email-templates` — lists templates from `cold_email_campaigns` + standard system templates; any admin.
- `GET /admin/dashboard/marketing/campaigns` — lists `marketing_campaigns` table; any admin.

**cold-email-service.js exported functions:**

- `loadCampaign(db, campaignId)` — loads campaign row
- `listActiveCampaigns(db)` — campaigns with `status='active'`
- `listPendingRecipients(db, campaignId, limit)` — next batch of unsent recipients
- `loadTemplates(campaign)` — loads email template content
- `submitToResend(payload, apiKey)` — calls Resend API to send
- `claimRunSlot(db, campaignId, nowIso, todayUtc, minMinutes)` — mutex to prevent concurrent runs
- `releaseRunSlot(...)` — releases mutex
- `markBatchSent(...)` — marks recipients as sent
- `recordRunStats(db, campaignId, nowIso, batchSize)` — records run metrics
- `processCampaign(db, campaign, options)` — orchestrates full send loop

**status:** implemented  
**gaps:**

- **PATCH status update (any admin)** — pausing or re-activating a campaign that could send thousands of emails should arguably require superadmin. Currently any admin account can re-activate a paused campaign.
- `releaseRunSlot` on error: the comment in admin.js:5432 warns "do NOT rewrite historical entries" for audit_logs — enforcement is comment-only, no DB constraint (e.g., no `INSERT`-only policy or trigger).
- No preview/dry-run mode for triggering — superadmin must trigger a live send to test. A dry-run flag would reduce accidental sends.
- Resend API key stored in env var — not scoped per-campaign; a single compromised campaign config could use the same key to send arbitrary email.
- `cold_email_campaigns` table has `active/paused/disabled` for one endpoint and `active/paused/draining` for another — two overlapping status enums suggest schema drift between marketing_campaigns and cold_email_campaigns tables.

**key_files:** `src/routes/admin.js:4189–4550`, `src/services/cold-email-service.js`  
**db_tables:** `cold_email_campaigns`, `marketing_campaigns`, `cold_email_recipients`, `rate_limits`, `audit_logs`

---

### 7. Email Service (Admin / Campaign Side)

**feature:** Transactional and campaign email delivery via Resend  
**user_story:** System sends admin password reset, security alert, gift delivery, share follow-up, and welcome emails.  
**expected_behavior (exported functions in email-service.js):**

- `sendPasswordResetEmail(email, token, expiresAt)` — user-facing reset
- `sendAdminPasswordResetEmail(email, token, expiresAt)` — admin account reset
- `sendAdminSecurityAlertEmail(email, meta)` — fires on admin password changes/suspicious events
- `sendVerificationEmail(email, token)` — user email verification
- `sendWelcomeEmail(email, name)` — new user onboarding
- `sendSecurityAlertEmail(email, options)` — user-facing security alert
- `sendGiftDeliveryEmail(payload)` — gift recipient notification
- `sendShareFollowupEmail(payload)` — share link follow-up sequence

**status:** implemented  
**gaps:**

- No rate limiting visible on `sendAdminSecurityAlertEmail` — could spam on rapid repeated password resets.
- `sendGiftDeliveryEmail` and `sendShareFollowupEmail` contain PII (recipient name/email) in payload — no scrubbing before logging observed.
- Unsubscribe handling for cold email recipients: `users.unsubscribed_at` column added in migration 115 but cold_email_recipients table may have separate unsubscribe tracking — potential for sends to users who globally unsubscribed.

**key_files:** `src/services/email-service.js`  
**db_tables:** `users` (email column), `cold_email_recipients`

---

### 8. Attribution Tracking (Apple Ads / Analytics)

**feature:** Apple Ads attribution token capture and resolution  
**user_story:** iOS app sends an attribution token on install; backend resolves it against Apple's API and stores campaign/keyword data.  
**expected_behavior:**

- `POST /analytics/attribution` (or similar) — user-authenticated endpoint; receives `attributionToken` from iOS; hashes token (SHA-256 for dedup), stores in `apple_ads_attribution`; kicks off async resolution.
- `attribution-service.js: resolveAppleAdsAttribution(userId, token)` — POSTs to `APPLE_ADS_ATTRIBUTION_URL` with 10-second timeout; parses response; upserts `apple_ads_attribution` row with fields: `status`, `api_status_code`, `campaign_id`, `ad_group_id`, `keyword_id`, `org_id`, `conversion_type`, `country_or_region`, `click_date`, `impression_date`.
- `getUserAttributionSummary(userId)` — returns acquisition source, status, confidence for a user.
- `GET /admin/dashboard/attribution/health` — admin-only health view of attribution pipeline.
- Developer test data detection: `isAppleAdsDeveloperTestData(payload)` — marks test-mode tokens as `status='test'` rather than polluting real attribution.

**status:** implemented  
**gaps:**

- No rate limiting visible on the user-facing attribution capture endpoint — a user could submit many tokens; dedup only via `attribution_token_sha256` uniqueness.
- `APPLE_ADS_ATTRIBUTION_URL` is an env var — if misconfigured (pointing to an attacker-controlled URL), the backend would POST user attribution tokens (containing install metadata) to the wrong endpoint.
- No Meta/AppsFlyer server-side attribution in this route file — Meta SKAN and AppsFlyer attribution appear to be handled separately (possibly client-side only or via AppsFlyer SDK), meaning server-side attribution completeness is limited to Apple Ads only.
- `apple_ads_attribution` stores `org_id`, `campaign_id`, `keyword_id` — these are low-sensitivity identifiers but tied to `user_id`, forming a PII linkage. No explicit retention policy enforced.

**key_files:** `src/routes/analytics.js`, `src/services/attribution-service.js`  
**db_tables:** `apple_ads_attribution`

---

### 9. Analytics Dashboard Metrics (Admin)

**feature:** Operational metrics for jobs, costs, enrollment, security, and platform overview  
**user_story:** Admin monitors platform health, job queue state, render costs, and security metrics from a single dashboard.  
**expected_behavior:**

- `GET /admin/dashboard/metrics/overview` — aggregate platform metrics; any admin.
- `GET /admin/dashboard/metrics/jobs` — job queue state (pending/running/failed counts by workflow type); any admin.
- `GET /admin/dashboard/metrics/costs` — estimated API costs per render type; any admin.
- `GET /admin/dashboard/metrics/enrollment` — enrollment funnel metrics; any admin.
- `GET /admin/dashboard/security/risk-metrics` — user risk score distribution; any admin.
- Viral-loop metrics: a `viral_loop_metrics` DB view (added in migrations around 115) with four columns: `cta_clicks_to_onelink`, `downloads_from_share`, `share_to_registration`, `registration_to_first_song`. Read directly via `railway connect postgres`, not yet exposed as an API endpoint.

**status:** implemented (metrics endpoints); partial (viral loop metrics — DB view exists, no admin API endpoint verified)  
**gaps:**

- Viral loop metrics view exists in DB but no dedicated admin endpoint found — operators must use `railway connect postgres` to query it, which is an operational friction and access-control bypass (anyone with Railway access can query it without going through the admin auth layer).
- `GET /admin/dashboard/metrics/costs` exposes API pricing data (Suno, Seed-VC unit costs) — this is internal cost info that could reveal margin structure; no superadmin restriction.
- No time-range filtering observed on metrics endpoints — they may always return all-time aggregates, which could be slow at scale.

**key_files:** `src/routes/admin.js:1556–1700`  
**db_tables:** `jobs`, `track_versions`, `entitlements`, `users`, `viral_loop_metrics` (view), `daily_aggregates`

---

### 10. Job Queue Management (Admin)

**feature:** Admin visibility and control over workflow jobs and dead-letter queue  
**user_story:** Admin monitors stuck/failed jobs, retries them, and manages the dead-letter queue.  
**expected_behavior:**

- `GET /admin/dashboard/jobs` — lists jobs with status/step filters; any admin.
- `POST /admin/dashboard/jobs/:id/retry` — retries a failed job; any admin.
- `GET /admin/dashboard/dlq` — dead-letter queue listing; any admin.
- `POST /admin/dashboard/dlq/:id/reprocess` — moves a DLQ item back to active queue; any admin.

**status:** implemented  
**gaps:**

- Job retry and DLQ reprocess are any-admin, not superadmin-gated. A retry on a billing or voice-conversion job can trigger expensive external API calls.
- No idempotency check visible on retry — retrying a job that already completed (or is in a weird partial state) could create duplicate renders or double-charge billing holds.
- No audit log written for job retries (admin action with cost/billing implications not audited).

**key_files:** `src/routes/admin.js:1700–1800`  
**db_tables:** `jobs`, `dead_letter_queue` (or `webhook_dlq`)

---

### 11. Content Moderation Queue (Admin)

**feature:** Admin moderation queue for flagged content  
**user_story:** Admin reviews AI-flagged content (lyrics, messages), takes approve/reject action.  
**expected_behavior:**

- `GET /admin/dashboard/moderation/queue` — lists pending moderation items; any admin.
- `POST /admin/dashboard/moderation/:id/[action]` — approves or rejects a moderated item; any admin.

**status:** implemented  
**gaps:**

- No superadmin restriction on moderation actions — any admin can approve content that was AI-flagged.
- No audit trail on moderation decisions visible in the grep output (no `INSERT INTO audit_logs` near moderation endpoints).
- "Approve" action on a blocked item could unblock a render for a user on a high risk score — no cross-check visible.

**key_files:** `src/routes/admin.js:1641–1700`  
**db_tables:** `track_versions` (moderation_status), `jobs`

---

### 12. Feature Flags (Admin)

**feature:** Runtime feature flag read and update  
**user_story:** Admin reads and toggles feature flags that control product behaviour (e.g., `my_voice_enabled`, `gift_require_app_claim`, `web_player_letterbox_enabled`, paywall gates, Seed-VC parameters).  
**expected_behavior:**

- `GET /admin/dashboard/feature-flags` — returns all flag names and current values; any admin.
- `PUT /admin/dashboard/feature-flags` — updates one or more flags; any admin. Error logged as `[Admin] FF_UPDATE_ERROR`.

**status:** implemented  
**gaps:**

- **No superadmin restriction on flag writes.** Feature flags control billing enforcement (`gift_prepay_enforced`), voice feature gating (`my_voice_enabled`), and paywall behaviour. Any admin can disable these controls, which is a high-impact action.
- No audit log on feature flag changes — there is no record of who changed `my_voice_enabled` from `true` to `false` or when.
- No validation that numeric flags (e.g., `seedvc_cfg_rate`, `web_player_letterbox_rollout_percent`) receive values within valid ranges — out-of-range values could crash downstream services.
- No change approval flow or dry-run.

**key_files:** `src/routes/admin.js:2764–2850`, `src/services/feature-flags.js`  
**db_tables:** `feature_flags` (or stored in-memory with DB persistence — migration 040, 047, 048 add seedvc flags)

---

### 13. Security & Audit Logs (Admin)

**feature:** Admin view of audit logs, rate-limit state, and rate-limit resets  
**user_story:** Admin reviews compliance audit trail and inspects/resets rate-limit state for users.  
**expected_behavior:**

- `GET /admin/dashboard/security/audit-logs` — paginated `audit_logs` table query; any admin.
- `GET /admin/dashboard/security/rate-limits` — lists current rate-limit rows; any admin.
- `DELETE /admin/dashboard/security/rate-limits/:userId/:actionType/reset` — deletes rate-limit rows for a user+action; any admin.

**audit_logs schema (from INSERT statement at admin.js:5435):**

```sql
INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
```

**status:** implemented  
**gaps:**

- `audit_logs` entries are insert-only by convention (comment: "do NOT rewrite historical entries") but no DB-level constraint (e.g., `SECURITY LABEL`, trigger, or separate write-once table) enforces this — an admin with DB access or a bug could mutate entries.
- `DELETE .../rate-limits/reset` is any-admin — resetting a rate limit for a suspicious user effectively re-arms their ability to brute-force or spam; this arguably requires superadmin.
- No PII redaction in `metadata_json` stored in `audit_logs` — raw user data (messages, recipient names) may be logged.
- Audit log viewing endpoint (`GET /admin/dashboard/security/audit-logs`) itself does not write an audit log entry, per the comment at admin.js:2531 ("admin reads of user behavioral data must [write audit entry]" — note: the sentence appears truncated/deferred).

**key_files:** `src/routes/admin.js:2531, 5432–5435`, `src/routes/admin.js:2850–2950`  
**db_tables:** `audit_logs`, `rate_limits`

---

### 14. Admin Story Sessions (Admin)

**feature:** Admin visibility into user story/context sessions  
**user_story:** Admin reviews story-context sessions for debugging or support.  
**expected_behavior:**

- `GET /admin/dashboard/story/sessions` — lists story sessions; any admin.

**status:** implemented (single endpoint)  
**gaps:**

- Story sessions contain personal narrative content (occasion details, recipient names, messages) — no PII redaction noted.
- Single endpoint with no superadmin guard despite containing sensitive personal content.

**key_files:** `src/routes/admin.js` (line ~1800)  
**db_tables:** `story_sessions` (migration 020)

---

### 15. Blog Post Management (Admin)

**feature:** Admin CMS for blog posts — list, create, autofill via AI, update, preview, review, repair  
**user_story:** Admin manages the Porizo marketing blog — creates and edits posts, uses AI to autofill content, previews before publishing, marks for review.  
**expected_behavior:**

- `GET /admin/dashboard/blog/posts` — list posts; any admin.
- `POST /admin/dashboard/blog/posts/autofill` — AI-generated blog content; any admin.
- `GET /admin/dashboard/blog/posts/:id` — get post; any admin.
- `POST /admin/dashboard/blog/posts` — create post; any admin.
- `PUT /admin/dashboard/blog/posts/:id` — update post; any admin.
- `POST /admin/dashboard/blog/posts/preview` — preview post HTML; any admin.
- `POST /admin/dashboard/blog/posts/:id/review` — mark for review; any admin.
- `POST /admin/dashboard/blog/posts/:id/repair` — AI repair of malformed content; any admin.

**status:** implemented  
**gaps:**

- `autofill` and `repair` endpoints trigger LLM calls with admin-controlled input — prompt injection into the LLM context is possible if blog post content is not sanitized before being passed to the AI provider.
- No superadmin restriction on `POST /admin/dashboard/blog/posts` — any admin can publish marketing content.
- No audit log on blog post creation/updates.

**key_files:** `src/routes/admin.js:700–1150`  
**db_tables:** `blog_posts` (inferred; not confirmed in migration list)

---

### 16. GDPR Audit Service

**feature:** GDPR-compliant audit logging for data subject requests and account deletion  
**user_story:** When a user requests data export (Art. 20) or account deletion (Art. 17), the system logs the event with PII-safe metadata for compliance.  
**expected_behavior (gdpr-audit-service.js exported functions):**

- `init(db)` — must be called before use; throws `"GDPR audit service not initialized — call init() first"` if not.
- `logAccountDeletion(userId, ipAddress)` — logs GDPR Art. 17 deletion event with `deletion_type`, `full_cascade`, `raw_recordings` fields; returns event ID.
- `logDataExportRequest(userId, ipAddress, exportFormat = "json")` — logs GDPR Art. 20 portability request; returns event ID.
- `logConsentChange(userId, consentType, granted, ipAddress)` — logs consent change event.
- (Additional: likely `logDataRetention` based on retention_policy searchable term.)

**status:** implemented — service exists with three confirmed exported functions  
**gaps:**

- **No user-facing API endpoint for data export is confirmed in the surveyed files.** `gdpr-audit-service.js` logs that a request was made but there is no evidence of a `GET /user/data-export` endpoint that actually assembles and delivers user data. If only the audit log exists but not the export delivery, GDPR Art. 20 compliance is incomplete.
- `logAccountDeletion` logs the deletion but whether the actual cascade (deleting voice data, audio files, share tokens) is triggered from this service or from a separate deletion handler is unclear from the function signatures alone.
- The service requires explicit `init(db)` — if the caller forgets to call it, the error is thrown at runtime rather than caught at startup.
- No deletion confirmation email to user after account deletion is handled in this service (may be elsewhere or absent).
- `ipAddress` is logged for each GDPR action — this is itself PII that needs its own retention policy.

**key_files:** `src/services/gdpr-audit-service.js`  
**db_tables:** `gdpr_audit_events` (inferred; or embedded in `audit_logs`)

---

### 17. Legal Pages and Public Routes

**feature:** Static legal pages (Terms, Privacy), marketing landing pages, unsubscribe, sitemap, robots.txt  
**user_story:** Users and search engines access Terms of Service, Privacy Policy, and marketing landing pages. Users unsubscribe from email.  
**expected_behavior (legal-route.js endpoints — all public, no auth required):**

- `GET /robots.txt` — robots file
- `GET /sitemap.xml` — sitemap
- `GET /llms.txt` — LLM crawl guidance
- `GET /<INDEXNOW_KEY>.txt` — domain ownership verification
- `GET /unsubscribe` + `POST /unsubscribe` — RFC 8058 one-click unsubscribe; POST satisfies List-Unsubscribe-Post header
- `GET /favicon.ico` + `GET /apple-touch-icon.png`
- `GET /legal/terms` + `GET /legal/privacy` — serve static HTML (loaded from `public/legal/`)
- `GET /terms` → 301 redirect to `/legal/terms`; `GET /privacy` → 301 redirect to `/legal/privacy`
- `GET /` — homepage
- `GET /support`, `/about`, `/pricing` — marketing pages
- `GET /mothers-day-song`, `/birthday-song-maker`, `/anniversary-song-gift`, `/custom-song-gift`, `/songfinch-alternative`, `/song-in-your-voice`, `/birthday-song-for-mom`, `/birthday-song-for-dad`, `/fathers-day-song`, `/graduation-song`, `/wedding-song-gift` — SEO landing pages
- `GET /gifts/` — gifts index page
- `GET /download` — app download redirect
- `GET /gifts/:slug` — gift landing page by slug

**status:** implemented  
**gaps:**

- Unsubscribe endpoint (`POST /unsubscribe`) sets `users.unsubscribed_at` but cold email `recipients` table tracking is separate — a user who unsubscribes via this endpoint may still appear in a cold email recipient list if the campaign lookup doesn't join on `users.unsubscribed_at`. The migration comment (near migration 115) explicitly notes this was a bug that crashed the daily job.
- SEO landing pages (e.g., `/song-in-your-voice`) serve marketing copy that the MEMORY notes contains false voice-clone promises — legal/compliance risk, not a code gap.
- No CSRF protection on `POST /unsubscribe` — could be triggered cross-origin to mass-unsubscribe users if user identifiers are predictable.
- Static HTML files served from `public/legal/` — any stale content in those files cannot be updated without a deploy.

**key_files:** `src/routes/legal.js`  
**db_tables:** `users` (unsubscribed_at), `cold_email_recipients`

---

### 18. MCP Server (External Agent Integration)

**feature:** Model Context Protocol (MCP) server exposing Porizo tools to AI agents  
**user_story:** An external AI agent (e.g., Claude) calls the Porizo MCP server to create personalized songs and gift links on behalf of users.  
**expected_behavior:**

- `POST /mcp` — handles MCP tool calls in JSON-response mode (no SSE streaming). Rate-limited (`MCP_ROUTE_CONFIG` includes rate limit).
- `GET /mcp` → 405 (SSE not supported).
- Registered MCP tools:
  - Tool 1 (line 98): "Create a personalized song from an occasion, a recipient name, and a personal message. Returns a deep link the user can open to start creating the song in the Porizo iOS app."
  - Tool 2 (line 130): (parameters not captured; likely a second song/gift tool variant)
- Authentication: the grep showed no `MCP_SECRET`, `Bearer`, `requireAdmin`, or similar auth check in `mcp-route.js`. The route appears to be **unauthenticated or relies solely on rate limiting** as its access control.

**status:** implemented  
**gaps:**

- **No authentication visible on the MCP endpoint.** If the `/mcp` route is publicly accessible without any token check, any caller can invoke the song-creation tool, potentially consuming Porizo's API credits (Suno, Seed-VC) at no cost. This is a significant abuse vector.
- Rate limiting is present (`MCP_ROUTE_CONFIG`) but without auth, rate limits can be trivially bypassed by rotating IPs.
- The MCP tool creates deep links — if the deep-link format is predictable, an attacker could enumerate valid song IDs.
- No user attribution for songs created via MCP — usage won't be billed to any user account.

**key_files:** `src/routes/mcp.js`  
**db_tables:** `tracks`, `track_versions` (inferred from song creation)

---

### 19. Events Service

**feature:** User event stream for behavioral analytics  
**user_story:** System records user events (actions) for behavioral analytics; admin or analytics system retrieves event history.  
**expected_behavior:**

- `EventsService` class (events-service.js).
- `getUserEvents(userId, limit = 50)` — returns up to `Math.min(limit, 200)` events for a user, newest first.
- `createEventsService(db)` — factory function.
- Events stored in `events` table (migration 027).

**status:** implemented  
**gaps:**

- `Math.min(limit, 200)` cap prevents unlimited reads but 200 events per call could still return significant PII-containing behavioral data in a single response.
- No admin endpoint for cross-user event querying observed — limits analytics use cases.
- Events table likely contains click/action metadata tied to `user_id` — retention policy not enforced at service level.

**key_files:** `src/services/events-service.js`  
**db_tables:** `events` (migration 027)

---

## Gap Cross-Reference (Top Security/Robustness Issues)

| #   | Gap                                                                                                                                         | Severity    | Feature(s)           | Location                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------- | ------------------------- |
| G1  | Admin login rate-limit is **fail-open** on DB error — unlimited brute-force during DB degradation                                           | High        | Admin Auth (#2)      | admin.js:667–701          |
| G2  | **MCP `/mcp` POST appears unauthenticated** — any caller can trigger song creation consuming paid API credits                               | High        | MCP Server (#18)     | mcp-route.js:161–256      |
| G3  | `PUT .../entitlements` (any admin, not superadmin) allows arbitrary credit manipulation                                                     | Medium-High | User Management (#4) | admin.js:1361             |
| G4  | Feature flag writes (`PUT /admin/dashboard/feature-flags`) not superadmin-gated — can disable billing enforcement                           | Medium-High | Feature Flags (#12)  | admin.js:2764             |
| G5  | `AdminGiftOpsService.listOrders` dynamic SQL filter keys may not be allowlisted — potential SQL column injection                            | Medium      | Gift Ops (#5)        | admin-gift-ops-service.js |
| G6  | **No actual data export delivery** found for GDPR Art. 20 — only the audit log exists                                                       | Medium      | GDPR Audit (#16)     | gdpr-audit-service.js     |
| G7  | `audit_logs` immutability enforced by comment only — no DB constraint prevents tampering                                                    | Medium      | Audit Logs (#13)     | admin.js:5432             |
| G8  | Feature flag numeric values not range-validated — out-of-range writes can crash downstream services                                         | Medium      | Feature Flags (#12)  | admin.js:2764–2850        |
| G9  | `POST /unsubscribe` lacks CSRF protection — cross-origin trigger possible                                                                   | Low-Medium  | Legal Pages (#17)    | legal.js                  |
| G10 | Cold email campaign PATCH (pause/activate) is any-admin — re-activating a mass-send campaign should be superadmin                           | Low-Medium  | Cold Email (#6)      | admin.js:4189             |
| G11 | No audit log on: feature flag changes, job retries, blog post edits, moderation decisions                                                   | Low-Medium  | Multiple             | admin.js (various)        |
| G12 | Viral loop metrics DB view has no admin API endpoint — requires direct DB access bypassing admin auth                                       | Low         | Analytics (#9)       | migrations/pg/115\*       |
| G13 | `admin-service.js` exports nothing (grep returned no output) — likely all logic is inline in admin.js, making the service layer a dead file | Low         | User Mgmt (#4)       | admin-service.js          |

---

## Relevant Migration Files (Key Schema)

| Migration                            | Relevance                              |
| ------------------------------------ | -------------------------------------- |
| `019_user_authentication.sql`        | User auth tables                       |
| `023_admin_users.sql`                | `admin_users`, `admin_sessions` tables |
| `024_security_config.sql`            | Security configuration                 |
| `027_events.sql`                     | `events` table                         |
| `028_share_attribution.sql`          | Attribution linkage                    |
| `029_daily_aggregates.sql`           | Analytics aggregates                   |
| `035_rate_limits_bigint.sql`         | `rate_limits` bigint upgrade           |
| `040_seedvc_feature_flags.sql`       | Feature flags (Seed-VC params)         |
| `047_tune_seedvc_feature_flags.sql`  | Feature flag additions                 |
| `048_timbre_blend_feature_flags.sql` | Feature flag additions                 |
| `063_admin_upgrade.sql`              | Admin table upgrades                   |
| `065_app_update_policy.sql`          | App update feature flags               |
| `066_ios_auto_update_policy.sql`     | iOS auto-update flags                  |

---

_Feature count: 19 features inventoried. Gaps: 13 identified, 2 high severity (G1, G2)._
